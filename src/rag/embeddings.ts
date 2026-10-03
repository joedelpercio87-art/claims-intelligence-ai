import OpenAI from 'openai';
import { embeddingModel } from './types.js';

export async function embedTexts(client: OpenAI, texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  const batchSize = 64;
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    const response = await client.embeddings.create({ model: embeddingModel, input: batch, encoding_format: 'float' });
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== batch.length) throw new Error('Embedding response did not include every input');
    vectors.push(...ordered.map(item => item.embedding));
  }
  return vectors;
}
