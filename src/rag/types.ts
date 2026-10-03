export const embeddingModel = 'text-embedding-3-small';
export const indexFormatVersion = 1;

export type PolicyChunk = {
  id: string;
  sourceFilename: string;
  policyTitle: string;
  sectionHeading: string;
  chunkText: string;
  embedding: number[];
};

export type PolicyIndex = {
  formatVersion: number;
  embeddingModel: string;
  vectorDimensions: number;
  chunks: PolicyChunk[];
};

export type PolicyPassage = Omit<PolicyChunk, 'embedding' | 'id'> & {
  similarityScore: number;
  fictionalPolicy: true;
};

export type RetrievalOptions = {
  topK?: number;
  minSimilarity?: number;
};
