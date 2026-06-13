import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Model, ModelEdge } from '../src/model/index.js';

// Resolve from cwd (the package root when vitest runs) so this works under both
// the node and jsdom environments, where import.meta.url differs.
export function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'test/fixtures', name), 'utf8');
}

export function ids(model: Model): string[] {
  return model.nodes.map((n) => n.id).sort();
}

export function edgeKey(e: ModelEdge): string {
  return `${e.from}-[${e.role}:${e.port}]->${e.to}`;
}

export function hasEdge(model: Model, from: string, to: string, role?: string): boolean {
  return model.edges.some((e) => e.from === from && e.to === to && (!role || e.role === role));
}

export function errors(model: Model): string[] {
  return model.diagnostics.filter((d) => d.level === 'error').map((d) => d.msg);
}
