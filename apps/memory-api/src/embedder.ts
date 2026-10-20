import { HashEmbedder, type Embedder } from '@hybrid/memory-store';

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

/**
 * The one real embedding model, run in this process with transformers.js so the worker's chunks
 * and a user's query are embedded identically (the worker calls POST /embed). The model is loaded
 * on first use; set EMBEDDING_MODEL=hash to run on the dependency-free hash embedder instead.
 */
export class TransformersEmbedder implements Embedder {
  readonly dimensions = 384;
  private pipe: Promise<FeatureExtraction> | null = null;

  constructor(readonly model: string = DEFAULT_EMBEDDING_MODEL) {}

  private load(): Promise<FeatureExtraction> {
    this.pipe ??= import('@huggingface/transformers').then(
      ({ pipeline }) => pipeline('feature-extraction', this.model) as Promise<FeatureExtraction>,
    );
    return this.pipe;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const extract = await this.load();
    const output = await extract(texts, { pooling: 'mean', normalize: true });
    const rows = output.tolist() as number[][];
    return rows.map((r) => Array.from(r));
  }
}

type FeatureExtraction = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): unknown }>;

export function createEmbedder(model = process.env.EMBEDDING_MODEL): Embedder {
  if (model === 'hash') return new HashEmbedder();
  return new TransformersEmbedder(model || DEFAULT_EMBEDDING_MODEL);
}
