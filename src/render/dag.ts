/**
 * SVG DAG view. Format-agnostic: renders the layout of a cone around a focus
 * node, re-focusing on node click. Pan/zoom via the svg viewBox; node fill comes
 * from kindColor() (same palette as the tree's kind badges). No deps.
 */
import { clear, kindColor } from './dom.js';
import { extractCone } from './cone.js';
import { layoutDag, type PositionedGraph } from './layout.js';
import { wirePaths } from './wires.js';
import type { ModelNode, ModelIndex } from '../model/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_HOPS = 1;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export interface DagController {
  focus(id: string): void;
}

export function renderDag(
  index: ModelIndex,
  host: HTMLElement,
  focusId: string,
  onSelect: (node: ModelNode) => void,
): DagController {
  let currentFocus = focusId;
  let hops = 2;
  // Set true once a pointer drag crosses the move threshold, so the trailing
  // `click` after a pan is ignored instead of selecting a node.
  let dragMoved = false;

  const draw = (): void => {
    clear(host);
    host.append(toolbar());
    const pg = layoutDag(extractCone(index, currentFocus, { hops }));
    host.append(buildSvg(pg));
  };

  const stepBtn = (cls: string, label: string, glyph: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dag-step ${cls}`;
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };

  const toolbar = (): HTMLElement => {
    const bar = document.createElement('div');
    bar.className = 'dag-toolbar';

    const stepper = document.createElement('div');
    stepper.className = 'dag-hop-stepper';

    const lbl = document.createElement('span');
    lbl.className = 'dag-hop-label';
    lbl.textContent = 'hops';

    const dec = stepBtn('dag-hop-dec', 'Fewer hops', '−', () => {
      if (hops > MIN_HOPS) { hops -= 1; draw(); }
    });
    dec.disabled = hops <= MIN_HOPS;

    const count = document.createElement('span');
    count.className = 'dag-hop-count';
    count.textContent = String(hops);
    count.setAttribute('aria-live', 'polite');

    const inc = stepBtn('dag-hop-inc', 'More hops', '+', () => { hops += 1; draw(); });

    stepper.append(lbl, dec, count, inc);
    bar.append(stepper);
    return bar;
  };

  const buildSvg = (pg: PositionedGraph): SVGSVGElement => {
    const root = svg('svg', {
      class: 'dag-svg',
      viewBox: `0 0 ${pg.width} ${pg.height}`,
      preserveAspectRatio: 'xMidYMin meet',
    });

    const defs = svg('defs');
    const marker = svg('marker', {
      id: 'dag-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
    });
    // `context-stroke` makes the (shared) arrowhead inherit each referencing
    // wire's stroke colour, so arrowheads match their source hue. Inline style
    // beats the .dag-arrow-head CSS, which stays as a fallback.
    marker.append(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'dag-arrow-head', style: 'fill:context-stroke' }));
    defs.append(marker);
    root.append(defs);

    // Lane-offset overlapping runs and add crossing hops across the whole edge
    // set, then render. Arrowhead lands on the consumer (path end).
    const dPaths = wirePaths(pg.edges);
    // Tint each wire by its source (the dependency it leaves): hues spread evenly
    // round the wheel for maximum distinguishability, desaturated vs the node
    // palette so the wires stay subtle. Sorted ids → deterministic assignment.
    const sources = [...new Set(pg.edges.map((e) => e.to))].sort();
    const strokeFor = (src: string): string => {
      const hue = Math.round((210 + (360 * sources.indexOf(src)) / sources.length) % 360);
      return `hsl(${hue}, 38%, 62%)`;
    };
    pg.edges.forEach((e, i) => {
      const path = svg('path', {
        class: 'dag-edge', d: dPaths[i], 'marker-end': 'url(#dag-arrow)',
        style: `stroke:${strokeFor(e.to)}`,
      });
      const title = svg('title');
      title.textContent = e.port;
      path.append(title);
      root.append(path);
    });

    for (const n of pg.nodes) {
      const g = svg('g', { class: `dag-node${n.isFocus ? ' focus' : ''}`, 'data-id': n.id, 'data-kind': n.kind });
      g.append(svg('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 6, class: 'dag-rect', style: `fill:${kindColor(n.kind)}` }));
      const label = svg('text', { x: n.x + 8, y: n.y + n.h / 2 + 4, class: 'dag-label' });
      label.textContent = n.label;
      g.append(label);
      if (n.hidden > 0) {
        const badge = svg('text', { x: n.x + n.w - 6, y: n.y + 14, class: 'dag-hidden', 'text-anchor': 'end' });
        badge.textContent = `+${n.hidden}`;
        g.append(badge);
      }
      g.addEventListener('click', () => {
        if (dragMoved) return; // this click ends a pan, not a selection
        const node = index.byId.get(n.id);
        if (!node) return;
        currentFocus = n.id;
        draw();
        onSelect(node);
      });
      root.append(g);
    }

    wirePanZoom(root, pg);
    return root;
  };

  const wirePanZoom = (root: SVGSVGElement, pg: PositionedGraph): void => {
    const vb = { x: 0, y: 0, w: pg.width, h: pg.height };
    const apply = (): void => root.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    root.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 0.9 : 1.1;
      vb.w *= factor; vb.h *= factor;
      apply();
    });
    // Pan only after the pointer moves past a small threshold, and capture the
    // pointer ONLY then. Capturing on pointerdown would retarget the pointerup
    // and make the browser fire `click` on the svg instead of the node group,
    // swallowing node selection — so a plain click must never capture.
    const DRAG_THRESHOLD = 4;
    let armed = false, dragging = false;
    let startX = 0, startY = 0, lastX = 0, lastY = 0;
    root.addEventListener('pointerdown', (ev) => {
      armed = true; dragging = false; dragMoved = false;
      startX = lastX = ev.clientX; startY = lastY = ev.clientY;
    });
    root.addEventListener('pointermove', (ev) => {
      if (!armed) return;
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true; dragMoved = true;
        // now keep moves even if the pointer leaves the svg
        if (ev.pointerId != null) root.setPointerCapture?.(ev.pointerId);
      }
      const scale = vb.w / (root.clientWidth || pg.width);
      vb.x -= (ev.clientX - lastX) * scale; vb.y -= (ev.clientY - lastY) * scale;
      lastX = ev.clientX; lastY = ev.clientY; apply();
    });
    const stop = (ev: PointerEvent): void => {
      if (dragging && ev.pointerId != null) root.releasePointerCapture?.(ev.pointerId);
      armed = false; dragging = false;
    };
    root.addEventListener('pointerup', stop);
    root.addEventListener('pointerleave', stop);
  };

  draw();
  return {
    // No-op when already focused so an app re-entrant select() (node click →
    // onSelect → app select → dag.focus) doesn't trigger a redundant redraw.
    focus: (id) => { if (id !== currentFocus && index.byId.has(id)) { currentFocus = id; draw(); } },
  };
}
