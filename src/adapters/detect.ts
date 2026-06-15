/**
 * Format registry + dispatch. Adding a format = one entry here (detection score,
 * parser, label, sample) — the UI derives its labels and sample list from this
 * list, so no other file needs touching.
 */
import { fromHs3Doc } from './hs3.js';
import type { Model, SourceFormat } from '../model/index.js';

interface DetectContext {
  ext: string;
  /** Parsed JSON, or undefined when the source is not JSON. */
  doc: unknown;
  source: string;
}

export interface FormatDescriptor {
  format: SourceFormat;
  label: string;
  /** Bundled sample files for this format; each becomes a dropdown entry. */
  samples: ReadonlyArray<{ value: string; label: string; path: string }>;
  /** Confidence in [0,1] that this descriptor should handle the input. */
  score(ctx: DetectContext): number;
  parse(ctx: DetectContext): Model;
}

const HS3_SECTIONS = ['distributions', 'functions', 'data', 'likelihoods', 'domains', 'parameter_points', 'analyses'];

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export const REGISTRY: readonly FormatDescriptor[] = [
  {
    format: 'hs3',
    label: 'HS3',
    samples: [
      { value: 'hs3-gaussian', label: 'gaussian + constraint', path: 'samples/hs3_gaussian.hs3' },
      { value: 'hs3-gaussian-product', label: 'gaussian product', path: 'samples/hs3_gaussian_product.hs3' },
      { value: 'hs3-histfactory', label: 'HistFactory-like', path: 'samples/hs3_histfactory_like.hs3' },
    ],
    // A section array is a strong signal (1); a lone object `metadata` (the only
    // required HS3 top-level) is a weak-but-sufficient one (0.5) so a valid
    // metadata-only document still routes here instead of being rejected.
    score: ({ doc }) =>
      !isObject(doc) ? 0 : HS3_SECTIONS.some((k) => Array.isArray(doc[k])) ? 1 : isObject(doc.metadata) ? 0.5 : 0,
    parse: ({ doc }) => fromHs3Doc(doc as Record<string, unknown>),
  },
];

/** Parse a model file: JSON, then highest-scoring descriptor by document shape. */
export function detectAndParse(filename: string, source: string): Model {
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch (err) {
    throw new Error(`Could not parse "${filename}" as JSON: ${(err as Error).message}`);
  }

  const ctx: DetectContext = { ext, doc, source };
  let best: FormatDescriptor | null = null;
  let bestScore = 0;
  for (const d of REGISTRY) {
    const s = d.score(ctx);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  if (!best) throw new Error(`Unrecognized model in "${filename}": no HS3 sections found`);
  return best.parse(ctx);
}
