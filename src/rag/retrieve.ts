import { readPolicyIndex } from './build-index.js';
import { createOpenAIClient, getDefaultMinSimilarity, getDefaultTopK, loadLocalEnvironment, safeRagError } from './config.js';
import { embedTexts } from './embeddings.js';
import type { PolicyPassage, RetrievalOptions } from './types.js';

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error('Query and index embedding dimensions do not match');
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i]! * right[i]!;
    leftNorm += left[i]! * left[i]!;
    rightNorm += right[i]! * right[i]!;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export async function retrievePolicyEvidence(query: string, options: RetrievalOptions = {}): Promise<PolicyPassage[]> {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 8000) throw new Error('query must contain 3 to 8000 characters');
  const topK = options.topK ?? getDefaultTopK();
  const minSimilarity = options.minSimilarity ?? getDefaultMinSimilarity();
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new Error('topK must be an integer from 1 to 20');
  if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) throw new Error('minSimilarity must be between 0 and 1');

  const index = readPolicyIndex();
  const [queryEmbedding] = await embedTexts(createOpenAIClient(), [query]);
  if (!queryEmbedding || queryEmbedding.length !== index.vectorDimensions) throw new Error('Query embedding does not match the local index dimensions');
  return index.chunks.map(chunk => ({
    sourceFilename: chunk.sourceFilename,
    policyTitle: chunk.policyTitle,
    sectionHeading: chunk.sectionHeading,
    chunkText: chunk.chunkText,
    similarityScore: cosineSimilarity(queryEmbedding, chunk.embedding),
    fictionalPolicy: true as const
  })).filter(result => result.similarityScore >= minSimilarity)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, topK);
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) throw new Error('Usage: npm run rag:retrieve -- "your policy question"');
  const results = await retrievePolicyEvidence(query);
  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error('Policy retrieval failed:', safeRagError(error));
  process.exitCode = 1;
});
