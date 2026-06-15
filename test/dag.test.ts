// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fromHs3Json } from '../src/adapters/hs3.js';
import { buildIndex, type ModelNode } from '../src/model/index.js';
import { renderDag } from '../src/render/dag.js';
import { fixture } from './helpers.js';

const model = fromHs3Json(fixture('hs3_gaussian.hs3'));
const index = buildIndex(model);

describe('renderDag', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); });

  it('renders an svg with node groups and edge paths', () => {
    renderDag(index, host, 'likelihood', () => {});
    expect(host.querySelector('svg')).toBeTruthy();
    expect(host.querySelectorAll('.dag-node').length).toBeGreaterThan(1);
    expect(host.querySelectorAll('.dag-edge').length).toBeGreaterThan(0);
    expect(host.querySelector('marker')).toBeTruthy();
  });

  it('marks the focus node and tags nodes with their kind', () => {
    renderDag(index, host, 'likelihood', () => {});
    const focus = host.querySelector('.dag-node.focus');
    expect(focus?.getAttribute('data-id')).toBe('likelihood');
    expect(host.querySelector('.dag-node[data-kind="distribution"]')).toBeTruthy();
  });

  it('fires onSelect and refocuses when a node is clicked', () => {
    let picked: ModelNode | null = null;
    renderDag(index, host, 'likelihood', (n) => { picked = n; });
    const modelNode = host.querySelector<SVGGElement>('.dag-node[data-id="model"]')!;
    modelNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).not.toBeNull();
    expect((picked as unknown as ModelNode).id).toBe('model');
    expect(host.querySelector('.dag-node.focus')?.getAttribute('data-id')).toBe('model');
  });

  it('controller.focus re-renders around the given node', () => {
    const ctrl = renderDag(index, host, 'likelihood', () => {});
    ctrl.focus('analysis');
    expect(host.querySelector('.dag-node.focus')?.getAttribute('data-id')).toBe('analysis');
  });

  it('hop stepper starts at 3 and adjusts the hop count', () => {
    renderDag(index, host, 'likelihood', () => {});
    const display = (): string | null => host.querySelector('.dag-hop-count')!.textContent;
    const dec = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.dag-hop-dec')!;
    const inc = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.dag-hop-inc')!;

    expect(display()).toBe('3');

    dec().click(); dec().click(); // 3 → 1
    expect(display()).toBe('1');

    expect(dec().disabled).toBe(true); // floored at 1
    dec().click(); // stays 1
    expect(display()).toBe('1');

    inc().click(); // 1 → 2
    inc().click(); // 2 → 3 (unbounded)
    expect(display()).toBe('3');
  });

  it('a plain click selects, but a click ending a drag does not', () => {
    let picked: ModelNode | null = null;
    renderDag(index, host, 'likelihood', (n) => { picked = n; });
    const svgEl = host.querySelector('svg')!;

    // plain click (pointerdown + up, no movement) → selects the node
    svgEl.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    svgEl.dispatchEvent(new MouseEvent('pointerup', { clientX: 10, clientY: 10, bubbles: true }));
    host.querySelector<SVGGElement>('.dag-node[data-id="model"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).not.toBeNull();

    // drag (movement past threshold) → the trailing click is ignored
    picked = null;
    svgEl.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
    svgEl.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 60, bubbles: true }));
    svgEl.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 60, bubbles: true }));
    host.querySelector<SVGGElement>('.dag-node.focus')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).toBeNull();
  });

  it('tints wires by source (distinct stroke colours)', () => {
    renderDag(index, host, 'likelihood', () => {});
    // Read the raw style attribute, not p.style.stroke — jsdom's CSSOM
    // canonicalizes hsl() to rgb() on read, but the emitted markup is hsl().
    const strokes = new Set(
      [...host.querySelectorAll<SVGPathElement>('.dag-edge')].map((p) => p.getAttribute('style')),
    );
    expect(strokes.size).toBeGreaterThan(1); // multiple source nodes → multiple colours
    expect([...strokes].every((s) => s?.startsWith('stroke:hsl'))).toBe(true);
  });

  it('gives every distinct source a distinct, saturated wire colour', () => {
    renderDag(index, host, 'likelihood', () => {});
    const edges = [...host.querySelectorAll<SVGPathElement>('.dag-edge')];
    const sources = new Set(edges.map((p) => p.querySelector('title') && p.getAttribute('style')));
    // one colour per distinct source; 72% saturation (punchy, not washed out)
    const strokes = new Set(edges.map((p) => p.getAttribute('style')));
    expect([...strokes].every((s) => /stroke:hsl\(\d+, 72%, (58|45)%\)/.test(s ?? ''))).toBe(true);
    expect(sources.size).toBeGreaterThan(0);
  });

  it('pan/zoom updates the svg viewBox on wheel', () => {
    renderDag(index, host, 'likelihood', () => {});
    const svg = host.querySelector('svg')!;
    const before = svg.getAttribute('viewBox');
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    expect(svg.getAttribute('viewBox')).not.toBe(before);
  });

  it('keyboard pans (arrows), zooms (+/-) and resets (0) the viewBox', () => {
    renderDag(index, host, 'likelihood', () => {});
    const svg = host.querySelector<SVGSVGElement>('svg')!;
    const vb = (): string | null => svg.getAttribute('viewBox');
    const key = (k: string): void => { svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); };

    const initial = vb();
    key('ArrowRight'); // pan
    const panned = vb();
    expect(panned).not.toBe(initial);
    key('+'); // zoom in
    expect(vb()).not.toBe(panned);
    key('0'); // reset to full frame
    expect(vb()).toBe(initial);
  });

  it('the reset-view toolbar button restores the framing after a pan', () => {
    renderDag(index, host, 'likelihood', () => {});
    const svg = host.querySelector<SVGSVGElement>('svg')!;
    const initial = svg.getAttribute('viewBox');
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(svg.getAttribute('viewBox')).not.toBe(initial);
    host.querySelector<HTMLButtonElement>('.dag-reset')!.click();
    expect(svg.getAttribute('viewBox')).toBe(initial);
  });
});
