/**
 * SVG DAG view. Format-agnostic: renders the layout of a cone around a focus
 * node, re-focusing on node click. Pan/zoom via the svg viewBox (pointer, wheel,
 * or keyboard); node fill comes from kindColor() (same palette as the tree's
 * kind badges). Nodes are focusable and keyboard-operable. No deps.
 */
import { clear, kindColor } from './dom.js';
import { extractCone } from './cone.js';
import { layoutDag, type PositionedGraph } from './layout.js';
import { wirePaths } from './wires.js';
import type { ModelNode, ModelIndex } from '../model/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_HOPS = 1;
const LABEL_PAD = 8;          // text inset on each side of the node box
const HIDDEN_BADGE_W = 22;    // space reserved for the "+N" badge when present
const PX_PER_CHAR = 7;        // ~12px monospace glyph advance

/** Truncate a label with an ellipsis so it stays within `widthPx` (the node box
 *  never grows; the text adjusts). Monospace font → char-width estimate is exact
 *  enough and needs no layout measurement. */
function fitLabel(text: string, widthPx: number): string {
  const max = Math.max(1, Math.floor(widthPx / PX_PER_CHAR));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

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
  let hops = 3;
  // Set true once a pointer drag crosses the move threshold, so the trailing
  // `click` after a pan is ignored instead of selecting a node.
  let dragMoved = false;
  // Memoise the (expensive) cone + layout + routing pipeline by focus/hops, so
  // re-focusing a recently-seen node skips it entirely.
  const layoutCache = new Map<string, PositionedGraph>();
  const layoutFor = (): PositionedGraph => {
    const key = `${currentFocus}:${hops}`;
    let pg = layoutCache.get(key);
    if (!pg) { pg = layoutDag(extractCone(index, currentFocus, { hops })); layoutCache.set(key, pg); }
    return pg;
  };

  // Reset the viewBox to frame the whole graph; replaced on each draw().
  let resetView = (): void => {};

  const draw = (): void => {
    clear(host);
    host.append(toolbar());
    host.append(buildSvg(layoutFor()));
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
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Graph controls');

    const stepper = document.createElement('div');
    stepper.className = 'dag-hop-stepper';
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-label', 'Hops');

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
    count.setAttribute('aria-label', `${hops} hops`);

    const inc = stepBtn('dag-hop-inc', 'More hops', '+', () => { hops += 1; draw(); });

    const reset = stepBtn('dag-reset', 'Reset view', '⌖', () => resetView());

    stepper.append(lbl, dec, count, inc);
    bar.append(stepper, reset);
    return bar;
  };

  const buildSvg = (pg: PositionedGraph): SVGSVGElement => {
    const focusNode = index.byId.get(currentFocus);
    const root = svg('svg', {
      class: 'dag-svg',
      viewBox: `0 0 ${pg.width} ${pg.height}`,
      preserveAspectRatio: 'xMidYMin meet',
      role: 'application',
      tabindex: 0,
      'aria-label': `Dependency graph${focusNode ? ` focused on ${focusNode.blockName}` : ''}, `
        + `${pg.nodes.length} node${pg.nodes.length === 1 ? '' : 's'}. `
        + 'Use Tab to reach nodes, Enter to focus a node, arrow keys to pan, plus and minus to zoom.',
    });
    root.append(svg('title'), svg('desc'));
    (root.firstChild as SVGTitleElement).textContent = 'Dependency graph';
    (root.lastChild as SVGDescElement).textContent =
      `Interactive dependency graph${focusNode ? ` centred on ${focusNode.blockName}` : ''}.`;

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
    // Tint each wire by its source (the dependency it leaves). To make wires of
    // NEARBY nodes maximally dissimilar: order sources by layout position
    // (top→bottom, left→right) so spatially-adjacent sources are consecutive,
    // then step the hue by the golden angle (~137.5°) — consecutive sources land
    // far apart on the wheel rather than a small 360/N step. Lightness alternates
    // and saturation is high so colours stay legible on light and dark
    // backgrounds. Deterministic (layout is deterministic).
    const pos = new Map(pg.nodes.map((n) => [n.id, n]));
    const sources = [...new Set(pg.edges.map((e) => e.to))].sort((a, c) => {
      const na = pos.get(a), nc = pos.get(c);
      return (na?.y ?? 0) - (nc?.y ?? 0) || (na?.x ?? 0) - (nc?.x ?? 0) || a.localeCompare(c);
    });
    const srcIndex = new Map(sources.map((s, i) => [s, i])); // O(1) lookup, not O(E) indexOf
    const GOLDEN_ANGLE = 137.508;
    const strokeFor = (src: string): string => {
      const i = srcIndex.get(src) ?? 0;
      const hue = Math.round((210 + i * GOLDEN_ANGLE) % 360);
      const light = i % 2 === 0 ? 58 : 45; // alternate to separate neighbours; floor kept legible on the dark canvas
      return `hsl(${hue}, 72%, ${light}%)`;
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

    const focusOnNode = (id: string): void => {
      const node = index.byId.get(id);
      if (!node) return;
      currentFocus = id;
      draw();
      onSelect(node);
    };

    for (const n of pg.nodes) {
      const g = svg('g', {
        class: `dag-node${n.isFocus ? ' focus' : ''}`, 'data-id': n.id, 'data-kind': n.kind,
        tabindex: 0, role: 'button',
        'aria-label': `${n.label}, ${n.kind}${n.hidden > 0 ? `, ${n.hidden} more connected node${n.hidden === 1 ? '' : 's'} hidden` : ''}`
          + `${n.isFocus ? ' (current focus)' : ''}`,
      });
      g.append(svg('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 6, class: 'dag-rect', style: `fill:${kindColor(n.kind)}` }));
      // Native tooltip with the full (untruncated) label.
      const tip = svg('title');
      tip.textContent = n.label;
      g.append(tip);
      const budget = n.w - LABEL_PAD * 2 - (n.hidden > 0 ? HIDDEN_BADGE_W : 0);
      const label = svg('text', { x: n.x + LABEL_PAD, y: n.y + n.h / 2 + 4, class: 'dag-label' });
      label.textContent = fitLabel(n.label, budget);
      g.append(label);
      if (n.hidden > 0) {
        const badge = svg('text', { x: n.x + n.w - 6, y: n.y + 14, class: 'dag-hidden', 'text-anchor': 'end' });
        badge.textContent = `+${n.hidden}`;
        g.append(badge);
      }
      g.addEventListener('click', () => {
        if (dragMoved) return; // this click ends a pan, not a selection
        focusOnNode(n.id);
      });
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); focusOnNode(n.id); }
      });
      root.append(g);
    }

    wirePanZoom(root, pg);
    return root;
  };

  const wirePanZoom = (root: SVGSVGElement, pg: PositionedGraph): void => {
    const vb = { x: 0, y: 0, w: pg.width, h: pg.height };
    const apply = (): void => root.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    resetView = (): void => { vb.x = 0; vb.y = 0; vb.w = pg.width; vb.h = pg.height; apply(); };
    const zoom = (factor: number): void => { vb.w *= factor; vb.h *= factor; apply(); };
    root.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoom(ev.deltaY < 0 ? 0.9 : 1.1);
    });
    // Keyboard pan/zoom when the svg itself holds focus (not a node group).
    root.addEventListener('keydown', (ev) => {
      if (ev.target !== root) return; // node groups handle their own keys
      const step = vb.w * 0.1;
      const moves: Record<string, () => void> = {
        ArrowLeft: () => { vb.x -= step; }, ArrowRight: () => { vb.x += step; },
        ArrowUp: () => { vb.y -= step; }, ArrowDown: () => { vb.y += step; },
        '+': () => zoom(0.9), '=': () => zoom(0.9), '-': () => zoom(1.1), '0': () => resetView(),
      };
      const fn = moves[ev.key];
      if (fn) { ev.preventDefault(); fn(); apply(); }
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
