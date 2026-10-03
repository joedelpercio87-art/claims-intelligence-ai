import assert from 'node:assert/strict';
import { getDefaultMinSimilarity, loadLocalEnvironment, safeRagError } from './config.js';
import { retrievePolicyEvidence } from './retrieve.js';

type VerificationQuestion = { label: string; query: string; expectedSources?: string[] };
const questions: VerificationQuestion[] = [
  {
    label: 'Approved authorization associated with an authorization-related claim denial',
    query: 'What should happen when an approved authorization is associated with a prior-authorization claim denial?',
    expectedSources: ['prior_authorization_policy.md']
  },
  {
    label: 'Unusual provider denial patterns',
    query: 'When should unusual provider denial patterns be escalated?',
    expectedSources: ['provider_escalation_policy.md']
  },
  {
    label: 'AI authority to deny a claim',
    query: 'Can AI automatically deny a healthcare claim?',
    expectedSources: ['ai_governance_policy.md']
  },
  {
    label: 'Deteriorating claim processing performance',
    query: 'What should management do when claim processing performance deteriorates?',
    expectedSources: ['claims_processing_policy.md', 'denial_management_policy.md']
  }
];

async function main(): Promise<void> {
  loadLocalEnvironment();
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for embedding-backed RAG verification; configure it in ignored .env without sharing it in chat.');
  const configuredThreshold = getDefaultMinSimilarity();
  const verified: Array<Record<string, unknown>> = [];
  for (const item of questions) {
    const results = await retrievePolicyEvidence(item.query);
    assert(results.length > 0, `No policy passages retrieved for: ${item.label}`);
    assert(results.some(result => item.expectedSources!.includes(result.sourceFilename)), `Expected a relevant policy source for: ${item.label}`);
    assert(results.every(result => result.fictionalPolicy === true && result.chunkText.length > 0 && result.similarityScore >= configuredThreshold), 'Retrieved passages must retain fictional-policy provenance and meet the configured threshold');
    verified.push({ label: item.label, status: 'PASS', results: results.map(({ sourceFilename, policyTitle, sectionHeading, chunkText, similarityScore, fictionalPolicy }) => ({ sourceFilename, policyTitle, sectionHeading, chunkText, similarityScore: Number(similarityScore.toFixed(4)), fictionalPolicy })) });
  }

  const unrelatedQuery = 'How should I adjust sourdough hydration for a warmer kitchen?';
  const unrelated = await retrievePolicyEvidence(unrelatedQuery, { topK: 4, minSimilarity: 0.75 });
  assert.equal(unrelated.length, 0, 'A high configured similarity threshold should suppress unrelated policy context');
  verified.push({ label: 'Unrelated cooking query with a 0.75 similarity threshold', status: 'PASS', resultCount: unrelated.length, minSimilarity: 0.75 });

  console.log(JSON.stringify({ status: 'PASS', questions: verified }, null, 2));
}

main().catch(error => {
  console.error('RAG verification failed:', safeRagError(error));
  process.exitCode = 1;
});
