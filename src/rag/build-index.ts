import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createOpenAIClient, getPolicyIndexPath, loadLocalEnvironment, safeRagError } from './config.js';
import { embedTexts } from './embeddings.js';
import { ingestPolicyDocuments } from './ingest.js';
import { embeddingModel, indexFormatVersion, type PolicyIndex } from './types.js';

export async function buildPolicyIndex(): Promise<{ policyCount: number; chunkCount: number; vectorDimensions: number; outputPath: string }> {
  const policyIndexPath = getPolicyIndexPath();
  const docs = ingestPolicyDocuments();
  const openai = createOpenAIClient();
  const embeddingInputs = docs.map(doc => `${doc.policyTitle}\n${doc.sectionHeading}\n${doc.chunkText}`);
  const vectors = await embedTexts(openai, embeddingInputs);
  if (vectors.length === 0 || vectors.some(vector => vector.length !== vectors[0]!.length)) throw new Error('Embedding vectors are empty or inconsistent');

  const index: PolicyIndex = {
    formatVersion: indexFormatVersion,
    embeddingModel,
    vectorDimensions: vectors[0]!.length,
    chunks: docs.map((doc, i) => ({ ...doc, embedding: vectors[i]! }))
  };
  mkdirSync(dirname(policyIndexPath), { recursive: true });
  const temporaryPath = `${policyIndexPath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(index), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, policyIndexPath);
  return { policyCount: new Set(docs.map(doc => doc.sourceFilename)).size, chunkCount: docs.length, vectorDimensions: index.vectorDimensions, outputPath: policyIndexPath };
}

export function readPolicyIndex(): PolicyIndex {
  const parsed = JSON.parse(readFileSync(getPolicyIndexPath(), 'utf8')) as PolicyIndex;
  if (parsed.formatVersion !== indexFormatVersion || parsed.embeddingModel !== embeddingModel || !Array.isArray(parsed.chunks)) throw new Error('Policy index format or embedding model is not supported; rebuild the index');
  return parsed;
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const summary = await buildPolicyIndex();
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error('Policy index build failed:', safeRagError(error));
  process.exitCode = 1;
});
