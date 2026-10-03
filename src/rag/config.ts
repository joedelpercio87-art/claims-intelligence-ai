import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import OpenAI from 'openai';

export function getPolicyDirectory(): string { return resolve(process.env.POLICY_DOCUMENTS_PATH ?? 'documents'); }
export function getPolicyIndexPath(): string { return resolve(process.env.RAG_INDEX_PATH ?? 'vector-indexes/policy-index.json'); }
export function getDefaultTopK(): number { return readIntegerConfig('RAG_TOP_K', 4, 1, 20); }
export function getDefaultMinSimilarity(): number { return readNumberConfig('RAG_MIN_SIMILARITY', 0.35, 0, 1); }

function readIntegerConfig(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

function readNumberConfig(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

export function loadLocalEnvironment(): void {
  const localEnv = resolve('.env');
  if (existsSync(localEnv)) process.loadEnvFile(localEnv);
}

export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required. Set it in the ignored .env file or process environment; do not put it in source or index files.');
  return new OpenAI({ apiKey });
}

export function safeRagError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('OPENAI_API_KEY is required')) return error.message;
  if (error !== null && typeof error === 'object') {
    const details = error as { status?: unknown; name?: unknown };
    if (details.status === 401) return 'OpenAI rejected the configured credential (HTTP 401). Update the key in the ignored .env file; do not share it in chat.';
    if (details.status === 403) return 'OpenAI rejected the request (HTTP 403). Check account access and configuration; provider details are suppressed.';
    if (details.status === 429) return 'OpenAI embeddings request was rate-limited or quota-limited (HTTP 429); provider details are suppressed.';
    if (details.name === 'APIConnectionError') return 'Could not connect to the OpenAI embeddings API; provider details are suppressed.';
  }
  return 'RAG operation failed; provider details are suppressed to protect credentials.';
}
