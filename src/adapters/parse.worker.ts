/**
 * Parse worker: runs `detectAndParse` off the main thread so a large or
 * pathological file can't hang the tab. The adapters and model layer are pure
 * (no DOM), so they run unchanged here; the resulting `Model` is a plain object
 * graph and crosses the boundary via structured clone.
 *
 * Each request carries a monotonic `id` echoed back in the response, so the main
 * thread can ignore results from a load that a newer one has superseded.
 */
import { detectAndParse } from './detect.js';
import type { Model } from '../model/index.js';

export interface ParseRequest {
  id: number;
  filename: string;
  source: string;
}

export type ParseResponse =
  | { id: number; ok: true; model: Model }
  | { id: number; ok: false; error: string };

/** Sent once, as soon as this module evaluates. The main thread uses its ABSENCE
 *  to tell "the worker never started" (a blocked or missing worker chunk, which
 *  fires no error event on the Worker in Chrome) apart from "this parse is just
 *  slow" — the two are otherwise indistinguishable from a pending request. */
export interface ParseReady { ready: true }

export type ParseMessage = ParseResponse | ParseReady;

(self as unknown as Worker).postMessage({ ready: true } satisfies ParseReady);

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, filename, source } = e.data;
  try {
    const model = detectAndParse(filename, source);
    (self as unknown as Worker).postMessage({ id, ok: true, model } satisfies ParseResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message } satisfies ParseResponse);
  }
};
