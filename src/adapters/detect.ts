/**
 * Format registry + dispatch. Adding a format = one entry here (detection score,
 * parser, label, sample) — the UI derives its labels and sample list from this
 * list, so no other file needs touching.
 *
 * Source is parsed as JSON opportunistically (most formats are JSON-encoded);
 * the attempt is non-fatal, so non-JSON formats (e.g. the yaml-ish `.xs3`) score
 * and parse off the raw `source`/`ext` instead.
 */
import { fromHs3Doc } from './hs3.js';
import { fromXs3Doc, fromXs3Yaml } from './xs3.js';
import type { Xs3TokenDict } from './xs3-tokens.js';
import { fromFlatppl } from './flatppl.js';
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
const XS3_BLOCK_KEYS = ['type', 'inputs', 'outputs', 'call_type', 'id'];

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** True when a parsed JSON doc looks like an XS3 token dict (block objects
 *  carrying XS3 fields), and not an HS3 document. */
function looksLikeXs3Doc(doc: unknown): boolean {
  if (!isObject(doc)) return false;
  if (HS3_SECTIONS.some((k) => Array.isArray(doc[k]))) return false; // it's HS3
  // An HS3 version marker is decisive — never claim such a doc, even if it
  // happens to carry an object property with a `type`/`id` field.
  if (isObject(doc.metadata) && 'hs3_version' in doc.metadata) return false;
  return Object.entries(doc).some(
    ([k, v]) => k !== 'metadata' && isObject(v) && XS3_BLOCK_KEYS.some((bk) => bk in v),
  );
}

/** Cheap shape check for the yaml-ish `.xs3` text: a `- block:` line AND at
 *  least one `id:`/`type:` field line — so a stray markdown/yaml list isn't
 *  mistaken for an XS3 model. */
function looksLikeXs3Text(source: string): boolean {
  return /^\s*-\s+[\w-]+\s*:/m.test(source) && /^\s+(id|type)\s*:/m.test(source);
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
  {
    format: 'xs3',
    label: 'XS3',
    samples: [
      { value: 'xs3-simple-fit', label: 'simple fit', path: 'samples/xs3_simple_fit_001.xs3' },
      { value: 'xs3-transport', label: 'stochastic transport', path: 'samples/xs3_transport_004.xs3' },
    ],
    // JSON concretization → recognised by block shape (1). The yaml-ish `.xs3`
    // doesn't parse as JSON (doc undefined): claim it by extension or a leading
    // `- block:` line.
    score: ({ doc, ext, source }) =>
      doc !== undefined
        ? looksLikeXs3Doc(doc) ? 1 : 0
        : ext === 'xs3' || looksLikeXs3Text(source) ? 1 : 0,
    parse: ({ doc, source }) =>
      doc !== undefined ? fromXs3Doc(doc as Xs3TokenDict) : fromXs3Yaml(source),
  },
  {
    format: 'flatppl',
    label: 'FlatPPL',
    samples: [
      { value: 'flatppl-linreg', label: 'linear regression', path: 'samples/flatppl_linear_regression.flatppl' },
      { value: 'flatppl-eight-schools', label: 'eight schools', path: 'samples/flatppl_eight_schools.flatppl' },
      { value: 'flatppl-poisson', label: 'Poisson (conjugate)', path: 'samples/flatppl_poisson.flatppl' },
      { value: 'flatppl-partial-pooling', label: 'partial pooling', path: 'samples/flatppl_partial_pooling.flatppl' },
      { value: 'flatppl-best-estimation', label: 'best estimation', path: 'samples/flatppl_best_estimation.flatppl' },
    ],
    // Never JSON. Claim by extension, or by a binding line (`name =`/`name ~`)
    // that isn't an XS3 `- block:` line.
    score: ({ doc, ext, source }) =>
      doc !== undefined ? 0 : ext === 'flatppl' || /^\s*[A-Za-z_]\w*\s*[=~](?!=)/m.test(source) ? 1 : 0,
    parse: ({ source }) => fromFlatppl(source),
  },
];

/** Parse a model file: try JSON, then route to the highest-scoring descriptor by
 *  document shape (JSON) or raw text/extension (non-JSON). */
export function detectAndParse(filename: string, source: string): Model {
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  // Non-fatal: many formats are JSON, but some (e.g. .xs3) are not — those score
  // off `source`/`ext` instead.
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch {
    doc = undefined;
  }

  const ctx: DetectContext = { ext, doc, source };
  let best: FormatDescriptor | null = null;
  let bestScore = 0;
  for (const d of REGISTRY) {
    const s = d.score(ctx);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  if (!best) throw new Error(`Unrecognized model in "${filename}": no known format matched`);
  return best.parse(ctx);
}
