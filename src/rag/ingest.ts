import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPolicyDirectory } from './config.js';
import type { PolicyChunk } from './types.js';

const maxChunkCharacters = 1400;
const overlapCharacters = 180;

function chunkSection(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const output: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChunkCharacters, normalized.length);
    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', end);
      const sentenceBreak = normalized.lastIndexOf('. ', end);
      const preferred = Math.max(paragraphBreak >= start + maxChunkCharacters * 0.55 ? paragraphBreak : -1,
        sentenceBreak >= start + maxChunkCharacters * 0.65 ? sentenceBreak + 1 : -1);
      if (preferred > start) end = preferred;
    }
    const part = normalized.slice(start, end).trim();
    if (part) output.push(part);
    if (end >= normalized.length) break;
    const next = Math.max(start + 1, end - overlapCharacters);
    start = next;
  }
  return output;
}

export function ingestPolicyDocuments(): Array<Omit<PolicyChunk, 'embedding'>> {
  const policyDirectory = getPolicyDirectory();
  const filenames = readdirSync(policyDirectory).filter(name => name.endsWith('.md')).sort();
  if (filenames.length === 0) throw new Error(`No Markdown policies found in ${policyDirectory}`);
  const chunks: Array<Omit<PolicyChunk, 'embedding'>> = [];
  for (const sourceFilename of filenames) {
    const markdown = readFileSync(join(policyDirectory, sourceFilename), 'utf8');
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const title = lines.find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim();
    if (!title) throw new Error(`${sourceFilename} has no level-one policy title`);
    if (!markdown.includes('FICTIONAL POLICY — CREATED FOR SYNTHETIC PORTFOLIO DEMONSTRATION ONLY')) throw new Error(`${sourceFilename} is missing its fictional-policy disclaimer`);

    let sectionHeading = 'Policy overview';
    let body: string[] = [];
    const flush = (): void => {
      const text = body.join('\n').trim();
      for (const [partIndex, chunkText] of chunkSection(text).entries()) {
        chunks.push({
          id: `${sourceFilename}:${chunks.length + 1}:${partIndex + 1}`,
          sourceFilename,
          policyTitle: title,
          sectionHeading,
          chunkText
        });
      }
      body = [];
    };

    for (const line of lines) {
      const heading = /^(#{2,3})\s+(.+)$/.exec(line);
      if (heading) {
        flush();
        sectionHeading = heading[2]!.trim();
      } else if (/^#\s+/.test(line)) {
        flush();
      } else {
        body.push(line);
      }
    }
    flush();
  }
  return chunks;
}
