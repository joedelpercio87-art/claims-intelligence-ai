import express from 'express';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { loadLocalEnvironment } from '../rag/config.js';
import { AgentExecutionError, ClaimsInvestigationAgent, safeAgentError } from '../agent/claims-agent.js';

loadLocalEnvironment();
const app = express();
const port = Number(process.env.API_PORT ?? 5181);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid TCP port');
const host = '127.0.0.1';
const questionSchema = z.object({ question: z.string().trim().min(8).max(2000) }).strict();
const dateRange = { fromDate: '2026-07-01', toDate: '2026-08-31' };

app.disable('x-powered-by');
app.use(express.json({ limit: '8kb', strict: true }));

type McpResult = { results?: unknown };
async function withMcp<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/mcp/server.js')],
    cwd: process.cwd(),
    env: { ...getDefaultEnvironment(), ...(process.env.DATABASE_PATH ? { DATABASE_PATH: process.env.DATABASE_PATH } : {}) },
    stderr: 'inherit'
  });
  const client = new Client({ name: 'claims-intelligence-ui-api', version: '1.0.0' });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

async function callAnalytics(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error('MCP analytics request failed');
  const structured = result.structuredContent as McpResult | undefined;
  if (!structured || !('results' in structured)) throw new Error('MCP returned an invalid metrics response');
  return structured.results;
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'claims-intelligence-local-api' }));

app.get('/api/dashboard', async (_req, res) => {
  try {
    const metrics = await withMcp(async client => {
      const [overall, imaging] = await Promise.all([
        callAnalytics(client, 'getClaimsPerformance', dateRange),
        callAnalytics(client, 'getClaimsPerformance', { ...dateRange, serviceCategory: 'Outpatient imaging' })
      ]);
      return { overall, imaging };
    });
    res.json({ reportingPeriod: '2026-08', comparisonPeriod: '2026-07', ...metrics });
  } catch {
    res.status(503).json({ error: 'August metrics are temporarily unavailable from the governed analytics service.' });
  }
});

app.post('/api/investigate', async (req, res) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a question between 8 and 2,000 characters.' });
    return;
  }
  let agent: ClaimsInvestigationAgent | undefined;
  try {
    agent = await ClaimsInvestigationAgent.connect();
    const result = await agent.investigate(parsed.data.question);
    res.json(result);
  } catch (error) {
    const source = error instanceof AgentExecutionError ? error.cause : error;
    const diagnostic = source !== null && typeof source === 'object' ? source as { status?: unknown; code?: unknown; name?: unknown } : {};
    console.error('Local agent request failed:', JSON.stringify({
      category: safeAgentError(error),
      errorClass: typeof diagnostic.name === 'string' ? diagnostic.name : 'unknown',
      status: typeof diagnostic.status === 'number' ? diagnostic.status : undefined,
      code: typeof diagnostic.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(diagnostic.code) ? diagnostic.code : undefined,
      observableTrace: error instanceof AgentExecutionError ? {
        mcpTools: error.observableTrace.mcpCalls.map(call => call.tool),
        policySearchCount: error.observableTrace.policySearches.length
      } : undefined
    }));
    res.status(502).json({ error: safeAgentError(error) });
  } finally {
    if (agent) await agent.close().catch(() => undefined);
  }
});

app.listen(port, host, () => {
  console.log(`Claims Intelligence local API listening on http://${host}:${port}`);
});
