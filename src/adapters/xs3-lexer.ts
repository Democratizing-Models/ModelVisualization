/**
 * Line-based lexer for the yaml-ish `.xs3` format.
 *
 * Ported from the reference engine's `lexer_xs3` (XS3-Architecture
 * @ss_examples_dev). Stock YAML parsers reject this format (bareword flow-map
 * values, and a real unbalanced-quote bug in the sample), so we mirror the
 * engine's tolerant, quote-stripping behavior rather than depend on a YAML lib.
 *
 * Output is the same token dict the JSON form produces, so both feed
 * `tokensToModel` unchanged.
 */
import type { Xs3Token, Xs3TokenDict } from './xs3-tokens.js';

const KNOWN_KEYS = new Set(['id', 'type', 'call_type', 'values', 'inputs', 'outputs', 'description']);

/**
 * Collect a bracketed value that begins on the key line `start` and may span
 * following lines until `close`. The opening bracket MUST be on the key line
 * (it always is in this format: `values: […`, `inputs: {…`). If it isn't, the
 * value is scalar/empty — return without advancing, so a malformed or scalar
 * `values:`/`inputs:` line can't run to EOF and silently swallow later blocks.
 */
function collectBracketed(
  lines: string[],
  start: number,
  open: string,
  close: string,
): { text: string; end: number } {
  const openIdx = lines[start].indexOf(open);
  if (openIdx === -1) return { text: '', end: start }; // no bracket on key line → scalar/empty
  let text = '';
  for (let i = start; i < lines.length; i++) {
    const segment = i === start ? lines[i].slice(openIdx + 1) : lines[i];
    const closeIdx = segment.indexOf(close);
    if (closeIdx !== -1) {
      text += segment.slice(0, closeIdx);
      return { text, end: i };
    }
    text += segment + ' ';
  }
  return { text, end: lines.length - 1 }; // unterminated bracket: best-effort, stop at EOF
}

function parseFlowMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(',')) {
    const cleaned = part.replace(/["{}]/g, '').trim();
    if (!cleaned) continue;
    const idx = cleaned.indexOf(':');
    if (idx === -1) continue;
    const key = cleaned.slice(0, idx).trim();
    const val = cleaned.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function parseNumberArray(text: string): number[] {
  return text
    .replace(/[[\]]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

export function lexXs3(source: string): Xs3TokenDict {
  const lines = source.split(/\r?\n/);
  // Null-proto so a `- __proto__:` block name can't touch any real prototype.
  const blocks: Xs3TokenDict = Object.create(null) as Xs3TokenDict;
  let current: (Xs3Token & Record<string, unknown>) | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (trimmed.startsWith('-')) {
      const name = trimmed.replace(/^-/, '').replace(/:/g, '').trim();
      current = {};
      blocks[name] = current;
      continue;
    }
    if (!current) continue;

    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();

    switch (key) {
      case 'id':
      case 'type':
      case 'call_type':
        current[key] = rest;
        break;
      case 'description':
        current.description = rest;
        break;
      case 'values': {
        // `values` is either an array `[…]` (data/bins) or a NamedTuple flow-map
        // `{…}` (preamble and other NamedTuple objects). Pick by whichever
        // bracket opens first on the key line.
        const arrIdx = lines[i].indexOf('[');
        const mapIdx = lines[i].indexOf('{');
        if (mapIdx !== -1 && (arrIdx === -1 || mapIdx < arrIdx)) {
          const { text, end } = collectBracketed(lines, i, '{', '}');
          current.values = parseFlowMap(text);
          i = end;
        } else {
          const { text, end } = collectBracketed(lines, i, '[', ']');
          current.values = parseNumberArray(text);
          i = end;
        }
        break;
      }
      case 'inputs': {
        const { text, end } = collectBracketed(lines, i, '{', '}');
        current.inputs = parseFlowMap(text);
        i = end;
        break;
      }
      case 'outputs': {
        const { text, end } = collectBracketed(lines, i, '{', '}');
        current.outputs = parseFlowMap(text);
        i = end;
        break;
      }
      default:
        if (!KNOWN_KEYS.has(key)) current[key] = rest; // formfree (metadata)
        break;
    }
  }

  return blocks;
}
