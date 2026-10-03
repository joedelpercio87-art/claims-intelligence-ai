import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  getAuthorizationAnalysis, getClaimsPerformance, getCostUtilization,
  getDenialAnalysis, getMemberPopulationImpact, getProviderPerformance
} from '../tools/analytics.js';

const intendedTools = [
  'getClaimsPerformance', 'getDenialAnalysis', 'getProviderPerformance',
  'getCostUtilization', 'getAuthorizationAnalysis', 'getMemberPopulationImpact'
].sort();

function resultRows(value: unknown): unknown {
  assert(value !== null && typeof value === 'object' && 'results' in value, 'MCP tool must return structuredContent.results');
  return (value as { results: unknown }).results;
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/mcp/server.js')],
    cwd: process.cwd(),
    env: { ...getDefaultEnvironment(), ...(process.env.DATABASE_PATH ? { DATABASE_PATH: process.env.DATABASE_PATH } : {}) },
    stderr: 'inherit'
  });
  const client = new Client({ name: 'claims-analytics-mcp-verifier', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name).sort();
    assert.deepEqual(names, intendedTools, 'MCP server must expose exactly the six intended analytics tools');
    assert(listed.tools.every(tool => tool.inputSchema && typeof tool.description === 'string' && tool.description.length > 0), 'Every tool must have an input schema and neutral description');
    assert(!names.some(name => /sql|query|execute/i.test(name)), 'No arbitrary SQL tool may be exposed');

    const calls: Array<{ name: string; args: Record<string, unknown>; direct: unknown }> = [
      { name: 'getClaimsPerformance', args: { fromDate: '2026-07-01', toDate: '2026-08-31' }, direct: getClaimsPerformance({ fromDate: '2026-07-01', toDate: '2026-08-31' }) },
      { name: 'getDenialAnalysis', args: { month: '2026-08', groupBy: 'denialCategory' }, direct: getDenialAnalysis({ month: '2026-08', groupBy: 'denialCategory' }) },
      { name: 'getProviderPerformance', args: { month: '2026-08', providerId: 'PRV-0004' }, direct: getProviderPerformance({ month: '2026-08', providerId: 'PRV-0004' }) },
      { name: 'getCostUtilization', args: { month: '2026-08', program: 'Medicare Advantage', serviceCategory: 'Outpatient imaging' }, direct: getCostUtilization({ month: '2026-08', program: 'Medicare Advantage', serviceCategory: 'Outpatient imaging' }) },
      { name: 'getAuthorizationAnalysis', args: { month: '2026-08', serviceCategory: 'Outpatient imaging' }, direct: getAuthorizationAnalysis({ month: '2026-08', serviceCategory: 'Outpatient imaging' }) },
      { name: 'getMemberPopulationImpact', args: { month: '2026-08', program: 'Medicare Advantage', ageBand: '65-74', region: 'West', riskCategory: 'Higher', serviceCategory: 'Outpatient imaging' }, direct: getMemberPopulationImpact({ month: '2026-08', program: 'Medicare Advantage', ageBand: '65-74', region: 'West', riskCategory: 'Higher', serviceCategory: 'Outpatient imaging' }) }
    ];

    const observed: Record<string, unknown> = {};
    for (const call of calls) {
      const response = await client.callTool({ name: call.name, arguments: call.args });
      assert.equal(response.isError, undefined, `${call.name} MCP call should succeed`);
      assert.deepEqual(resultRows(response.structuredContent), call.direct, `${call.name} MCP result must match the direct analytics function`);
      observed[call.name] = call.direct;
    }

    const authRows = observed.getAuthorizationAnalysis as Array<Record<string, unknown>>;
    const authStatuses = new Set(authRows.map(row => String(row.authorizationStatus)));
    for (const status of ['Approved', 'Denied', 'Expired', 'Pending', 'No linked authorization']) assert(authStatuses.has(status), `August outpatient imaging results must include ${status}`);
    assert(authRows.some(row => row.authorizationStatus === 'Approved' && Number(row.priorAuthorizationDenialCount) > 0), 'Approved authorization / prior authorization denial association should be retrievable as an observation');

    const arbitrarySql = await client.callTool({ name: 'getClaimsPerformance', arguments: { sql: 'SELECT * FROM claims' } });
    assert.equal(arbitrarySql.isError, true, 'Strict tool input schema must reject arbitrary SQL fields');

    console.log(JSON.stringify({
      status: 'PASS',
      listedTools: names,
      invokedTools: calls.map(call => call.name),
      directComparisons: calls.map(call => ({ tool: call.name, identical: true })),
      augustImagingAuthorizationStatuses: [...authStatuses].sort(),
      approvedAuthorizationWithPriorAuthorizationDenialRows: authRows.filter(row => row.authorizationStatus === 'Approved' && Number(row.priorAuthorizationDenialCount) > 0).length,
      arbitrarySqlRejected: true
    }, null, 2));
  } finally {
    await client.close();
    await transport.close();
  }
}

main().catch(error => {
  console.error('MCP verification failed:', error);
  process.exitCode = 1;
});
