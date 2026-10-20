/**
 * Turns text into vectors for retrieval. The API owns the one real model (transformers.js, lazily
 * loaded) so both the worker's chunks and a user's query are embedded the same way; the hash
 * embedder below is deterministic and dependency-free for tests and for a store without a model.
 */
export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A hashed bag-of-words vector: cheap, deterministic, good enough to exercise vector search. */
export class HashEmbedder implements Embedder {
  readonly model = 'hash-bow/v1';
  constructor(readonly dimensions = 64) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const token of tokenize(text)) {
        const h = fnv1a(token);
        v[h % this.dimensions]! += (h >>> 8) % 2 === 0 ? 1 : -1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
