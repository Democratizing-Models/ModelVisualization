// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildIndex, type Model, type ModelNode } from '../src/model/index.js';
import { renderDag } from '../src/render/dag.js';

const long = 'parameters_of_interest_and_then_some_more';
const nodes: ModelNode[] = [
  { id: 'L', blockName: long, kind: 'parameter', type: 't', raw: {} },
  { id: 'b', blockName: 'b', kind: 'distribution', type: 't', raw: {} },
];
const model: Model = {
  format: 'hs3', meta: {}, roots: [], diagnostics: [], nodes,
  edges: [{ from: 'b', to: 'L', role: 'input', port: 'mu' }],
};

describe('DAG label fitting', () => {
  it('truncates an over-long label with an ellipsis (node box unchanged)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderDag(buildIndex(model), host, 'L', () => {});

    const labels = [...host.querySelectorAll<SVGTextElement>('.dag-label')];
    const longLabel = labels.find((t) => t.textContent?.startsWith('parameters'))!;
    expect(longLabel.textContent!.length).toBeLessThan(long.length);
    expect(longLabel.textContent!.endsWith('…')).toBe(true);
  });

  it('keeps the full name available as a <title> tooltip', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderDag(buildIndex(model), host, 'L', () => {});

    const titles = [...host.querySelectorAll('g.dag-node title')].map((t) => t.textContent);
    expect(titles).toContain(long);
  });

  it('leaves a short label intact', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderDag(buildIndex(model), host, 'L', () => {});

    const labels = [...host.querySelectorAll<SVGTextElement>('.dag-label')].map((t) => t.textContent);
    expect(labels).toContain('b'); // short, unchanged, no ellipsis
  });
});
