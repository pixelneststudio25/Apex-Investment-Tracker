// Hand-built SVG charts (no library). Colours come from CSS classes, so both themes just work and no inline
// styles are needed. Every chart carries a text description for screen readers.
import { svg } from './dom.js';
import { formatNairaCompact } from '../engine/index.js';
import { fmtDate, HIDDEN_TEXT, isHidden } from './fmt.js';

let uid = 0;
const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const niceMax = (v) => {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v)), n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};

// points: [{ date, a, b }]. `a` is the gold line with an area under it; `b` is the dashed muted line.
// onHover(point | null) lets the caller show a readout outside the SVG.
export function lineChart({ points, description, onHover }) {
  const W = 640, H = 240, L = 8, R = 8, T = 14, B = 26, id = `g${++uid}`;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': description, preserveAspectRatio: 'xMidYMid meet' });
  if (points.length < 2) return root;
  const x0 = dayNum(points[0].date), x1 = dayNum(points[points.length - 1].date) || x0 + 1;
  const top = niceMax(Math.max(...points.map((p) => Math.max(p.a, p.b || 0))) * 1.05);
  const X = (d) => L + ((dayNum(d) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - v / top) * (H - T - B);
  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join('');

  root.append(svg('defs', {}, svg('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
    svg('stop', { offset: '0%', class: 'stop-a', 'stop-opacity': 0.32 }), svg('stop', { offset: '100%', class: 'stop-a', 'stop-opacity': 0 }))));
  for (const f of [0, 0.5, 1]) {
    const y = Y(top * f);
    root.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
    if (f > 0 && !isHidden()) root.append(svg('text', { x: L + 2, y: y - 4, class: 'axis' }, formatNairaCompact(Math.round(top * f))));
  }
  root.append(svg('text', { x: L, y: H - 6, class: 'axis' }, fmtDate(points[0].date)), svg('text', { x: W - R, y: H - 6, class: 'axis', 'text-anchor': 'end' }, fmtDate(points[points.length - 1].date)));
  if (points.some((p) => p.b != null)) root.append(svg('path', { d: path('b'), class: 'line-b' }));
  root.append(svg('path', { d: `${path('a')}L${X(points[points.length - 1].date).toFixed(1)} ${Y(0)}L${X(points[0].date).toFixed(1)} ${Y(0)}Z`, fill: `url(#${id})` }),
    svg('path', { d: path('a'), class: 'line-a' }));

  const cross = svg('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
  const dot = svg('circle', { r: 4.5, class: 'dot', visibility: 'hidden' });
  const hit = svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', class: 'hit' });
  root.append(cross, dot, hit);
  const at = (clientX) => {
    const box = root.getBoundingClientRect(), px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(X(p.date) - px) < Math.abs(X(points[best].date) - px)) best = i; });
    return points[best];
  };
  const show = (p) => {
    cross.setAttribute('x1', X(p.date)); cross.setAttribute('x2', X(p.date)); dot.setAttribute('cx', X(p.date)); dot.setAttribute('cy', Y(p.a));
    cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible'); onHover?.(p);
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); onHover?.(null); };
  hit.addEventListener('pointermove', (e) => show(at(e.clientX)));
  hit.addEventListener('pointerdown', (e) => show(at(e.clientX)));
  hit.addEventListener('pointerleave', hide);
  return root;
}

// segments: [{ label, valueKobo }]. Colours are seg-1 .. seg-6 in the stylesheet.
export function donut({ segments, centre, description }) {
  const S = 180, c = S / 2, r = 70, sw = 22, C = 2 * Math.PI * r, gap = segments.length > 1 ? 2.5 : 0;
  const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'donut', role: 'img', 'aria-label': description });
  root.append(svg('circle', { cx: c, cy: c, r, class: 'donut-track', 'stroke-width': sw, fill: 'none' }));
  const total = segments.reduce((t, s) => t + s.valueKobo, 0);
  let acc = 0;
  if (total > 0) {
    segments.forEach((s, i) => {
      const len = (s.valueKobo / total) * C;
      root.append(svg('circle', {
        cx: c, cy: c, r, fill: 'none', 'stroke-width': sw, class: `seg-${(i % 6) + 1}`,
        'stroke-dasharray': `${Math.max(0, len - gap).toFixed(2)} ${(C - Math.max(0, len - gap)).toFixed(2)}`,
        'stroke-dashoffset': (-acc).toFixed(2), transform: `rotate(-90 ${c} ${c})`,
      }));
      acc += len;
    });
  }
  if (centre) root.append(svg('text', { x: c, y: c + 7, 'text-anchor': 'middle', class: 'donut-total' }, isHidden() ? HIDDEN_TEXT : centre));
  return root;
}
export const segmentClass = (i) => `seg-${(i % 6) + 1}`;
