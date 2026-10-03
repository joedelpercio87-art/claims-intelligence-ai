import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import {
  getAuthorizationAnalysis, getClaimsPerformance, getCostUtilization,
  getDenialAnalysis, getMemberPopulationImpact, getProviderPerformance
} from '../tools/analytics.js';

const services = ['Outpatient imaging', 'Primary care', 'Emergency', 'Inpatient', 'Behavioral health', 'Laboratory', 'Specialty care'] as const;
const programs = ['Medicare Advantage', 'Medicaid'] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Must be a valid YYYY-MM-DD date');

const filters = {
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('Optional service month in YYYY-MM format.'),
  fromDate: date.optional().describe('Optional inclusive service start date.'),
  toDate: date.optional().describe('Optional inclusive service end date.'),
  program: z.enum(programs).optional().describe('Optional synthetic program filter.'),
  serviceCategory: z.enum(services).optional().describe('Optional service category filter.'),
  providerId: z.string().regex(/^PRV-\d{4}$/).optional().describe('Optional synthetic provider identifier.')
};

function filterSchema(extra: Record<string, z.ZodType> = {}) {
  return z.object({ ...filters, ...extra }).strict().superRefine((value, ctx) => {
    if (value.month && (value.fromDate || value.toDate)) ctx.addIssue({ code: 'custom', message: 'month cannot be combined with fromDate or toDate' });
    if (value.fromDate && value.toDate && value.fromDate > value.toDate) ctx.addIssue({ code: 'custom', message: 'fromDate must be on or before toDate' });
  });
}

function structured(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: { results: data } };
}

export function createAnalyticsMcpServer(): McpServer {
  const server = new McpServer({ name: 'claims-intelligence-analytics', version: '1.0.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool('getClaimsPerformance', {
    description: 'Returns claims performance metrics including volume, financial amounts, denial rates, and processing time for validated filters.',
    inputSchema: filterSchema(), annotations
  }, async args => structured(getClaimsPerformance(args)));

  server.registerTool('getDenialAnalysis', {
    description: 'Summarizes denial counts, rates, and shares grouped by month, denial category, service category, provider, or program for validated filters.',
    inputSchema: filterSchema({ groupBy: z.enum(['month', 'denialCategory', 'serviceCategory', 'provider', 'program']).optional().describe('Dimension used to group denial metrics.') }), annotations
  }, async args => structured(getDenialAnalysis(args)));

  server.registerTool('getProviderPerformance', {
    description: 'Returns monthly provider level claim volume, denial metrics, amounts, service category mix, and prior authorization denial metrics for validated filters. Provider records are synthetic and results are descriptive.',
    inputSchema: filterSchema(), annotations
  }, async args => structured(getProviderPerformance(args)));

  server.registerTool('getCostUtilization', {
    description: 'Returns monthly claim volume and billed, allowed, and paid amounts by service category and program for validated filters.',
    inputSchema: filterSchema(), annotations
  }, async args => structured(getCostUtilization(args)));

  server.registerTool('getAuthorizationAnalysis', {
    description: 'Summarizes claim and claim line relationships with linked authorization statuses and prior authorization denial metrics by month, service category, provider, and program. Associations are descriptive and do not establish cause.',
    inputSchema: filterSchema(), annotations
  }, async args => structured(getAuthorizationAnalysis(args)));

  server.registerTool('getMemberPopulationImpact', {
    description: 'Returns aggregated synthetic population counts, claim metrics, rates, and amounts grouped by program, age band, region, risk category, and service category. Does not return individual member records.',
    inputSchema: filterSchema({
      ageBand: z.enum(['0-17', '18-34', '35-49', '50-64', '65-74', '75+']).optional(),
      region: z.enum(['Northeast', 'Midwest', 'South', 'West']).optional(),
      riskCategory: z.enum(['Lower', 'Moderate', 'Higher']).optional()
    }), annotations
  }, async args => structured(getMemberPopulationImpact(args)));

  return server;
}

async function main(): Promise<void> {
  const server = createAnalyticsMcpServer();
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch(error => {
    console.error('MCP server failed:', error);
    process.exitCode = 1;
  });
}
