import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import OpenAI from 'openai';
import type { ResponseInputItem, Tool } from 'openai/resources/responses/responses.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { createOpenAIClient, getDefaultMinSimilarity, loadLocalEnvironment, safeRagError } from '../rag/config.js';
import { retrievePolicyEvidence } from '../rag/retrieve.js';

const ANALYTICS_TOOLS = [
  'getClaimsPerformance', 'getDenialAnalysis', 'getProviderPerformance',
  'getCostUtilization', 'getAuthorizationAnalysis', 'getMemberPopulationImpact'
] as const;
const maxPolicyTopK = 4;
const maxToolCallsPerQuestion = 40;
const maxToolRounds = 20;
const maxToolRowsToModel = 300;

const finalAnswerSchema = z.object({
  answer: z.string().min(1),
  evidenceGaps: z.array(z.string()),
  unsupportedCausationAppeared: z.boolean(),
  responsibleAiBoundariesPreserved: z.boolean()
}).strict();

const policySearchSchema = z.object({
  query: z.string().min(5).max(1000),
  topK: z.number().int().min(1).max(maxPolicyTopK).optional()
}).strict();

const SYSTEM_INSTRUCTIONS = `You are a synthetic healthcare claims operations investigation assistant. Use tools when operational data or fictional company policy evidence is needed. Choose evidence dynamically based on the user's question.

Evidence separation:
- MCP analytics results are structured operational observations from synthetic SQLite data. Cite them as [OP-1], [OP-2], etc., matching the operational evidence IDs supplied with tool results.
- searchCompanyPolicies results are passages from fictional internal policy examples. Cite them as [POL-1], [POL-2], etc. Do not present them as external law, regulation, payer, clinical, or real organizational policy.
- Keep measured observations and interpretations distinct. A correlation or coincident change is not causation.
- State missing denominators, comparison limits, synthetic-data limitations, and other evidence gaps when relevant.

Responsible use:
- Never assert fraud, abuse, medical necessity, improper care, provider intent, member fault, or unsupported causal attribution. A user accusation is not evidence. Explain what the available evidence can and cannot establish.
- Provider concentrations and authorization associations are descriptive only. An approved authorization linked to an authorization-related claim denial is an observed pattern, not automatically an error or cause.
- AI is decision support only. Do not recommend autonomous claim denial/adjudication or autonomous medical-necessity decisions. Consequential decisions require human review.
- Use only aggregate member population outputs; never request or expose individual member records.
- Never request or reveal chain-of-thought. Provide a concise, auditable answer, not private reasoning.
- Do not answer unrelated questions using healthcare policy retrieval; say the assistant is scoped to synthetic claims operations.

Tool guidance:
- Use getClaimsPerformance for overall monthly volume, amounts, denials, and processing-time comparisons.
- Use getDenialAnalysis to compare denial rates or categories across months, programs, services, or providers.
- Use getProviderPerformance for a provider's descriptive metrics; a high rate does not prove wrongdoing.
- Use getCostUtilization for cost/volume comparisons; do not invent PMPM.
- Use getAuthorizationAnalysis for linked/unlinked authorization statuses and prior-authorization denial patterns.
- Use getMemberPopulationImpact only when the user explicitly asks about aggregated population segments. It is not needed for ordinary claims, provider, authorization, or policy questions.
- Use searchCompanyPolicies only for questions about internal operating actions, escalation, governance, or policy. Retrieve only relevant passages; do not search or include the entire corpus.
- Keep investigations efficient: use the smallest set of targeted comparisons that answers the question. Avoid repeating equivalent month/grouping queries or exhaustively exploring every dimension. A question about August usually needs August compared with July, plus a focused breakdown only when it clarifies the observed change.

Final response format: return the required JSON fields. In answer, label OBSERVED FACTS and INTERPRETATION REQUIRING ADDITIONAL EVIDENCE separately when both are present. Cite evidence IDs. evidenceGaps should identify material missing evidence. Set unsupportedCausationAppeared true only if your answer actually asserted unsupported causation or wrongdoing as fact. Set responsibleAiBoundariesPreserved true only if your answer preserved the boundaries above.`;

export type McpCallTrace = {
  evidenceId: string;
  tool: string;
  parameters: Record<string, unknown>;
  resultRowCount: number | null;
  returnedToModel: boolean;
  /** Small aggregate-only preview for auditable presentation; never includes individual member rows. */
  resultPreview?: unknown[];
};
export type PolicySearchTrace = {
  evidenceId: string;
  query: string;
  topK: number;
  minSimilarity: number;
  resultCount: number;
  results: Array<{ sourceFilename: string; policyTitle: string; sectionHeading: string; similarityScore: number; passage: string }>;
};
export type AgentTrace = { mcpCalls: McpCallTrace[]; policySearches: PolicySearchTrace[] };
export type AgentResult = z.infer<typeof finalAnswerSchema> & {
  question: string;
  mcpCallCount: number;
  policySearchCount: number;
  trace: AgentTrace;
};

export class AgentExecutionError extends Error {
  constructor(readonly cause: unknown, readonly observableTrace: AgentTrace) {
    super('Agent execution failed');
    this.name = 'AgentExecutionError';
  }
}

function safeAgentError(error: unknown): string {
  const source = error instanceof AgentExecutionError ? error.cause : error;
  if (source !== null && typeof source === 'object' && 'status' in source) {
    const status = (source as { status?: unknown }).status;
    if (status === 401) return 'OpenAI authentication failed (HTTP 401).';
    if (status === 403) return 'OpenAI request was denied (HTTP 403).';
    if (status === 429) return 'OpenAI request was rate-limited or quota-limited (HTTP 429).';
    if (status === 400 || status === 422) {
      const fields = source as { code?: unknown; param?: unknown };
      const safeCode = typeof fields.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(fields.code) ? fields.code : undefined;
      const safeParam = typeof fields.param === 'string' && /^[A-Za-z0-9_.$\[\]-]{1,120}$/.test(fields.param) ? fields.param : undefined;
      const details = [safeCode && `code=${safeCode}`, safeParam && `param=${safeParam}`].filter(Boolean).join(' ');
      return `OpenAI rejected a request or response schema (HTTP ${status})${details ? `; ${details}` : ''}.`;
    }
    if (status === 404) return 'OpenAI endpoint or configured model was not found (HTTP 404).';
    if (typeof status === 'number' && status >= 500) return `OpenAI service error (HTTP ${status}).`;
  }
  if (source instanceof Error) {
    // Verification assertions use fixed, developer-authored messages; report those without
    // exposing model/provider error text or any generated response metadata.
    if (source.name === 'AssertionError' && /^[A-Za-z0-9 ,.'?!:;()/-]{1,180}$/.test(source.message)) return `Agent verification assertion failed: ${source.message}`;
    if (source.name === 'AssertionError') return 'Agent verification assertion failed; generated response details were withheld.';
    if (source.message === 'Agent returned a non-JSON final response') return 'Agent final response did not match the required JSON format.';
    if (source.message === 'Agent issued invalid JSON tool arguments') return 'Agent produced invalid JSON tool arguments.';
    if (source.message === 'Agent reached the maximum tool round count without a final answer') return 'Agent tool loop reached its maximum rounds without a final answer.';
    if (source.message === 'Agent exceeded the per-question tool-call limit') return 'Agent exceeded the configured tool-call limit.';
    if (source.message === 'Connected MCP server did not expose exactly the six approved analytics tools') return 'MCP capability discovery failed the six-tool allowlist check.';
    if (source.message === 'MCP result did not contain structured results') return 'MCP returned an unexpected structured-result format.';
    if (['APIConnectionError', 'APIError', 'ZodError', 'TypeError', 'AbortError', 'Error'].includes(source.name)) {
      return `Agent or policy-retrieval operation failed (${source.name}); provider details are suppressed.`;
    }
  }
  return safeRagError(source);
}

function openAiMcpTools(discovered: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>): Tool[] {
  const names = discovered.map(tool => tool.name).sort();
  const expected = [...ANALYTICS_TOOLS].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Connected MCP server did not expose exactly the six approved analytics tools');
  return discovered.map(tool => {
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') throw new Error(`MCP tool ${tool.name} has no input schema`);
    const parameters = { ...tool.inputSchema };
    delete parameters.$schema;
    return { type: 'function', name: tool.name, description: tool.description ?? 'Deterministic healthcare analytics tool.', parameters, strict: false } as Tool;
  });
}

function allObjectsHaveNoIndividualMembers(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(allObjectsHaveNoIndividualMembers);
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['member_id', 'memberId', 'memberIdentifier'].includes(key)) return false;
      if (!allObjectsHaveNoIndividualMembers(child)) return false;
    }
  }
  return true;
}

function structuredMcpData(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.structuredContent as { results?: unknown } | undefined;
  if (!content || !('results' in content)) throw new Error('MCP result did not contain structured results');
  return content.results;
}

export class ClaimsInvestigationAgent {
  private readonly transport: StdioClientTransport;
  private readonly openai: OpenAI;
  private readonly tools: Tool[];
  private readonly mcpNames = new Set<string>(ANALYTICS_TOOLS);
  private readonly client: Client;

  private constructor(openai: OpenAI, transport: StdioClientTransport, tools: Tool[], client: Client) {
    this.openai = openai;
    this.transport = transport;
    this.tools = tools;
    this.client = client;
  }

  static async connect(): Promise<ClaimsInvestigationAgent> {
    loadLocalEnvironment();
    const openai = createOpenAIClient();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/mcp/server.js')],
      cwd: process.cwd(),
      env: { ...getDefaultEnvironment(), ...(process.env.DATABASE_PATH ? { DATABASE_PATH: process.env.DATABASE_PATH } : {}) },
      stderr: 'inherit'
    });
    const client = new Client({ name: 'claims-investigation-agent', version: '1.0.0' });
    try {
      await client.connect(transport);
      const list = await client.listTools();
      const tools = openAiMcpTools(list.tools);
      return new ClaimsInvestigationAgent(openai, transport, tools, client);
    } catch (error) {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  async investigate(question: string): Promise<AgentResult> {
    const trace: AgentTrace = { mcpCalls: [], policySearches: [] };
    try { return await this.runInvestigation(question, trace); }
    catch (error) { throw new AgentExecutionError(error, trace); }
  }

  private async runInvestigation(question: string, trace: AgentTrace): Promise<AgentResult> {
    const toolSpecs: Tool[] = [
      ...this.tools,
      {
        type: 'function', name: 'searchCompanyPolicies',
        description: 'Search the fictional internal policy corpus and return only the most relevant policy passages with source metadata and similarity scores. Use for policy and management-action guidance; results are fictional internal examples, not external rules.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { query: { type: 'string', minLength: 5, maxLength: 1000 }, topK: { type: 'integer', minimum: 1, maximum: maxPolicyTopK } },
          required: ['query', 'topK']
        }, strict: true
      }
    ];
    const model = process.env.OPENAI_AGENT_MODEL ?? 'gpt-5.5';
    const textFormat = {
      format: {
        type: 'json_schema' as const,
        name: 'claims_investigation_answer',
        strict: true,
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            answer: { type: 'string' },
            evidenceGaps: { type: 'array', items: { type: 'string' } },
            unsupportedCausationAppeared: { type: 'boolean' },
            responsibleAiBoundariesPreserved: { type: 'boolean' }
          },
          required: ['answer', 'evidenceGaps', 'unsupportedCausationAppeared', 'responsibleAiBoundariesPreserved']
        }
      }
    };
    const inputItems: ResponseInputItem[] = [{ role: 'user', content: [{ type: 'input_text', text: question }] }];
    let totalCalls = 0;

    for (let round = 0; round < maxToolRounds; round++) {
      const response = await this.openai.responses.create({
        model, instructions: SYSTEM_INSTRUCTIONS, input: inputItems, tools: toolSpecs,
        tool_choice: 'auto', parallel_tool_calls: true, text: textFormat, store: false
      });
      const calls = response.output.filter(item => item.type === 'function_call');
      if (calls.length === 0) {
        let parsed: unknown;
        try { parsed = JSON.parse(response.output_text); }
        catch { throw new Error('Agent returned a non-JSON final response'); }
        const final = finalAnswerSchema.parse(parsed);
        return { question, ...final, mcpCallCount: trace.mcpCalls.length, policySearchCount: trace.policySearches.length, trace };
      }

      inputItems.push(...response.output as unknown as ResponseInputItem[]);
      for (const call of calls) {
        totalCalls++;
        if (totalCalls > maxToolCallsPerQuestion) throw new Error('Agent exceeded the per-question tool-call limit');
        let args: unknown;
        try { args = JSON.parse(call.arguments); } catch { throw new Error('Agent issued invalid JSON tool arguments'); }

        if (call.name === 'searchCompanyPolicies') {
          const policyArgs = policySearchSchema.parse(args);
          const topK = policyArgs.topK ?? 4;
          const minSimilarity = getDefaultMinSimilarity();
          const passages = await retrievePolicyEvidence(policyArgs.query, { topK, minSimilarity });
          const evidenceId = `POL-${trace.policySearches.length + 1}`;
          const visible = passages.map(({ sourceFilename, policyTitle, sectionHeading, chunkText, similarityScore, fictionalPolicy }) => ({ sourceFilename, policyTitle, sectionHeading, passage: chunkText, similarityScore, fictionalPolicy }));
          trace.policySearches.push({ evidenceId, query: policyArgs.query, topK, minSimilarity, resultCount: visible.length,
            results: passages.map(({ sourceFilename, policyTitle, sectionHeading, similarityScore, chunkText }) => ({ sourceFilename, policyTitle, sectionHeading, similarityScore, passage: chunkText })) });
          inputItems.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ evidenceId, evidenceType: 'fictional policy', results: visible }) });
          continue;
        }

        if (!this.mcpNames.has(call.name)) throw new Error(`Agent requested an unavailable capability: ${call.name}`);
        const mcpArgs = args as Record<string, unknown>;
        const evidenceId = `OP-${trace.mcpCalls.length + 1}`;
        const result = await this.client.callTool({ name: call.name, arguments: mcpArgs });
        if (result.isError) {
          trace.mcpCalls.push({ evidenceId, tool: call.name, parameters: mcpArgs, resultRowCount: null, returnedToModel: false });
          inputItems.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: 'MCP rejected the tool request; revise validated parameters.' }) });
          continue;
        }
        const data = structuredMcpData(result);
        if (!allObjectsHaveNoIndividualMembers(data)) throw new Error('MCP response contained an individual member record; it was withheld from the agent');
        const rowCount = Array.isArray(data) ? data.length : null;
        if (rowCount !== null && rowCount > maxToolRowsToModel) {
          trace.mcpCalls.push({ evidenceId, tool: call.name, parameters: mcpArgs, resultRowCount: rowCount, returnedToModel: false });
          inputItems.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: `MCP result has ${rowCount} aggregate rows; narrow filters to at most ${maxToolRowsToModel} rows.` }) });
          continue;
        }
        trace.mcpCalls.push({ evidenceId, tool: call.name, parameters: mcpArgs, resultRowCount: rowCount, returnedToModel: true,
          resultPreview: Array.isArray(data) ? data.slice(0, 3) : undefined });
        inputItems.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ evidenceId, evidenceType: 'operational observation', tool: call.name, results: data }) });
      }
    }
    throw new Error('Agent reached the maximum tool round count without a final answer');
  }

  async close(): Promise<void> {
    await this.client.close();
    await this.transport.close();
  }
}

export { safeAgentError };
