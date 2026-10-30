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

// points: [{ date, a, b }]. `a` is the accent line with an area under it; `b` is the dashed muted line.
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
  root.append(svg('path', { d: `${path('a')}L${X(points[points.length - 1].date).toFixed(1)} ${Y(0)}L${X(points[0].date).toFixed(1)} ${Y(0)}Z`, fill: `url(#${id})`, class: 'area' }),
    svg('path', { d: path('a'), class: 'line-a', pathLength: 1 }));

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

// A calm placeholder for "no history yet": faint gridlines and a dashed line that is clearly not data.
export function ghostChart() {
  const W = 640, H = 200;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart chart--ghost', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  for (const y of [30, 100, 170]) root.append(svg('line', { x1: 8, x2: W - 8, y1: y, y2: y, class: 'grid' }));
  root.append(svg('path', { d: 'M8 150 C 120 148, 190 120, 290 112 S 470 70, 632 44', class: 'ghost-line' }), svg('circle', { cx: 632, cy: 44, r: 5, class: 'ghost-dot' }));
  return root;
}

// segments: [{ label, valueKobo }]. Colours are seg-1 .. seg-6 in the stylesheet. Each segment sweeps in (CSS, driven by
// custom properties set here). root.highlight(i | null) emphasises one segment and shows its value in the centre.
export function donut({ segments, centre, description, formatValue = () => '' }) {
  const S = 180, c = S / 2, r = 72, sw = 18, C = 2 * Math.PI * r, gap = segments.length > 1 ? 3 : 0;
  const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'donut', role: 'img', 'aria-label': description });
  root.append(svg('circle', { cx: c, cy: c, r, class: 'donut-track', 'stroke-width': sw, fill: 'none' }));
  const total = segments.reduce((t, s) => t + s.valueKobo, 0);
  const circles = [];
  let acc = 0;
  if (total > 0) {
    segments.forEach((s, i) => {
      const len = (s.valueKobo / total) * C, dash = Math.max(0, len - gap);
      const el = svg('circle', {
        cx: c, cy: c, r, fill: 'none', 'stroke-width': sw, class: `donut-seg ${segmentClass(i)}`,
        'stroke-dasharray': `${dash.toFixed(2)} ${(C - dash).toFixed(2)}`, 'stroke-dashoffset': (-acc).toFixed(2), transform: `rotate(-90 ${c} ${c})`,
        style: { '--i': i, '--C': C.toFixed(2), '--len': dash.toFixed(2), '--rest': (C - dash).toFixed(2) },
      });
      circles.push(el); root.append(el);
      acc += len;
    });
  }
  const value = svg('text', { x: c, y: c + 3, 'text-anchor': 'middle', class: 'donut-total' }, isHidden() ? HIDDEN_TEXT : centre);
  const caption = svg('text', { x: c, y: c + 22, 'text-anchor': 'middle', class: 'donut-cap' }, 'Total');
  root.append(value, caption);
  root.highlight = (i) => {
    circles.forEach((el, j) => el.classList.toggle('is-hl', i === j));
    root.classList.toggle('has-hl', i != null);
    value.textContent = i == null ? (isHidden() ? HIDDEN_TEXT : centre) : (isHidden() ? HIDDEN_TEXT : formatValue(segments[i].valueKobo));
    caption.textContent = i == null ? 'Total' : segments[i].label;
  };
  return root;
}
export const segmentClass = (i) => `seg-${(i % 6) + 1}`;

// ===================== Outlook charts (Phase 12-ii) =====================
// Both charts take monthly points from the Outlook engine (js/models/outlook.js), so every point is one month apart and
// the x position is simply the point's index. Both can be scrubbed by finger, mouse or keyboard (arrow keys, Home, End),
// call onHover(point | null, index) so the screen can show a live readout, and carry a text description. The pure helpers
// are exported so they can be tested without a screen.

/** The index of the point nearest to pixel position `px` when `count` points span `width` pixels from `left`. */
export function nearestIndex(px, { count, left, width }) {
  if (count < 2) return 0;
  const i = Math.round(((px - left) / width) * (count - 1));
  return Math.max(0, Math.min(count - 1, i));
}

/**
 * Layers for the stacked chart, biggest at the bottom. `parts` is projectOutlook(...).parts; `months` is its months.
 * With more than `keep + 1` investments the smallest ones are added together as "Everything else", so the chart never
 * needs more than six colours. Returns [{ id, label, values: [kobo per month] }] whose values add up to the monthly total.
 */
export function stackLayers(months, parts, keep = 5) {
  const ranked = [...parts].sort((a, b) => b.endKobo - a.endKobo || (a.investment.name < b.investment.name ? -1 : 1));
  const named = ranked.length > keep + 1 ? ranked.slice(0, keep) : ranked, rest = ranked.slice(named.length);
  const layers = named.map((p) => ({ id: p.investment.id, label: p.investment.name, values: months.map((m) => m.byInvestment[p.investment.id] || 0) }));
  if (rest.length) layers.push({ id: 'other', label: 'Everything else', count: rest.length, values: months.map((m) => rest.reduce((t, p) => t + (m.byInvestment[p.investment.id] || 0), 0)) });
  return layers;
}

const yearsWord = (months) => { const y = (months.length - 1) / 12; return y === 1 ? '1 year' : `${y} years`; };

/** Screen-reader text for the band chart. `money` formats kobo (the screen passes one that honours hidden amounts). */
export function describeBand(bands, money, { real = false } = {}) {
  const last = bands[bands.length - 1];
  return `Band chart of the projected worth of your portfolio over ${yearsWord(bands)}${real ? ', in today\'s money' : ''}. The middle line ends at ${money(last.baseKobo)}, with a cautious case of ${money(last.lowKobo)} and an optimistic case of ${money(last.highKobo)}. This is a projection, not a fact.`;
}
/** Screen-reader text for the stacked chart. */
export function describeStack(layers, months, money, { real = false } = {}) {
  const last = months.length - 1, total = layers.reduce((t, l) => t + l.values[last], 0);
  const top = layers.slice().sort((a, b) => b.values[last] - a.values[last]).slice(0, 3).map((l) => `${l.label} ${money(l.values[last])}`).join(', ');
  return `Stacked chart of where the projected worth comes from over ${yearsWord(months)}${real ? ', in today\'s money' : ''}. It ends at ${money(total)} in all. Largest parts: ${top}. This is a projection, not a fact.`;
}

// Shared frame: gridlines, end labels, the scrub line and the hit area. `topValue` is the highest value to fit.
function frame({ count, firstDate, lastDate, topValue, label, onPoint, onLeave, valueText }) {
  const W = 640, H = 240, L = 8, R = 8, T = 14, B = 26;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'group', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' });
  const top = niceMax(topValue * 1.05);
  const X = (i) => L + (i / Math.max(1, count - 1)) * (W - L - R);
  const Y = (v) => T + (1 - v / top) * (H - T - B);
  for (const f of [0, 0.5, 1]) {
    const y = Y(top * f);
    root.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
    if (f > 0 && !isHidden()) root.append(svg('text', { x: L + 2, y: y - 4, class: 'axis' }, formatNairaCompact(Math.round(top * f))));
  }
  root.append(svg('text', { x: L, y: H - 6, class: 'axis' }, fmtDate(firstDate)), svg('text', { x: W - R, y: H - 6, class: 'axis', 'text-anchor': 'end' }, fmtDate(lastDate)));
  return { root, W, H, L, R, T, B, X, Y, top };
}

// The scrub line, the dot on the main line and the hit area, added last so they sit on top. `at(i)` gives the dot's value.
function scrub(f, { count, at, onHover, valueText, pick = null, dot: withDot = true }) {
  const { root, W, L, R, T, H, B, X, Y } = f;
  const cross = svg('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
  const dot = svg('circle', { r: 4.5, class: 'dot', visibility: 'hidden' });
  const hit = svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', class: 'hit', tabindex: 0, role: 'slider',
    'aria-label': 'Move along the projection', 'aria-orientation': 'horizontal', 'aria-valuemin': 0, 'aria-valuemax': count - 1, 'aria-valuenow': count - 1 });
  root.append(cross, dot, hit);
  let current = null;
  const show = (i) => {
    current = i;
    const x = X(i);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    if (withDot) { dot.setAttribute('cx', x); dot.setAttribute('cy', Y(at(i))); dot.setAttribute('visibility', 'visible'); }
    hit.setAttribute('aria-valuenow', i); const t = valueText?.(i); if (t) hit.setAttribute('aria-valuetext', t);
    onHover?.(i);
  };
  const hide = () => { current = null; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); onHover?.(null); };
  const place = pick || ((px) => nearestIndex(px, { count, left: L, width: W - L - R }));
  const fromPointer = (e) => { const box = root.getBoundingClientRect(); return place(((e.clientX - box.left) / box.width) * W); };
  hit.addEventListener('pointermove', (e) => show(fromPointer(e)));
  hit.addEventListener('pointerdown', (e) => show(fromPointer(e)));
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'PageUp' ? 12 : e.key === 'PageDown' ? -12 : 0;
    if (e.key === 'Home') { e.preventDefault(); show(0); return; }
    if (e.key === 'End') { e.preventDefault(); show(count - 1); return; }
    if (e.key === 'Escape') { hide(); return; }
    if (!step) return;
    e.preventDefault(); show(Math.max(0, Math.min(count - 1, (current ?? count - 1) + step)));
  });
  root.scrubTo = (i) => show(Math.max(0, Math.min(count - 1, i))); // lets a screen or a test move the scrub line
  return root;
}

/**
 * Cautious-to-optimistic band around the base line. bands: [{ date, lowKobo, baseKobo, highKobo }] one per month.
 * onHover(band | null, index) gives the live readout. `valueText(band)` words the point for screen readers.
 */
export function bandChart({ bands, description, onHover, valueText }) {
  const count = bands.length;
  if (count < 2) return svg('svg', { viewBox: '0 0 640 240', class: 'chart', role: 'img', 'aria-label': description });
  const f = frame({ count, firstDate: bands[0].date, lastDate: bands[count - 1].date, topValue: Math.max(...bands.map((b) => b.highKobo), 1), label: description });
  const { X, Y, root } = f, pt = (i, v) => `${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
  const forward = bands.map((b, i) => `${i ? 'L' : 'M'}${pt(i, b.highKobo)}`).join('');
  const back = bands.map((_, i) => { const j = count - 1 - i; return `L${pt(j, bands[j].lowKobo)}`; }).join('');
  root.append(svg('path', { d: `${forward}${back}Z`, class: 'band' }),
    svg('path', { d: bands.map((b, i) => `${i ? 'L' : 'M'}${pt(i, b.highKobo)}`).join(''), class: 'band-edge' }),
    svg('path', { d: bands.map((b, i) => `${i ? 'L' : 'M'}${pt(i, b.lowKobo)}`).join(''), class: 'band-edge' }),
    svg('path', { d: bands.map((b, i) => `${i ? 'L' : 'M'}${pt(i, b.baseKobo)}`).join(''), class: 'line-base' }));
  return scrub(f, { count, at: (i) => bands[i].baseKobo, onHover: (i) => onHover?.(i == null ? null : bands[i], i), valueText: valueText && ((i) => valueText(bands[i])) });
}

/**
 * Stacked areas: which investments the worth comes from. months: [{ date }] one per month; layers: from stackLayers().
 * Colours are chart tokens by position (layer-1 is the bottom), the same order as segmentClass(i) uses for legends.
 */
export function stackedChart({ months, layers, description, onHover, valueText }) {
  const count = months.length;
  if (count < 2 || !layers.length) return svg('svg', { viewBox: '0 0 640 240', class: 'chart', role: 'img', 'aria-label': description });
  const totals = months.map((_, i) => layers.reduce((t, l) => t + l.values[i], 0));
  const f = frame({ count, firstDate: months[0].date, lastDate: months[count - 1].date, topValue: Math.max(...totals, 1), label: description });
  const { X, Y, root } = f, pt = (i, v) => `${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
  const base = new Array(count).fill(0);
  layers.forEach((l, k) => {
    const lower = base.slice(), upper = base.map((b, i) => b + l.values[i]);
    const d = `${upper.map((v, i) => `${i ? 'L' : 'M'}${pt(i, v)}`).join('')}${lower.map((_, i) => { const j = count - 1 - i; return `L${pt(j, lower[j])}`; }).join('')}Z`;
    root.append(svg('path', { d, class: `layer layer-${(k % 6) + 1}` }));
    for (let i = 0; i < count; i++) base[i] = upper[i];
  });
  root.append(svg('path', { d: totals.map((v, i) => `${i ? 'L' : 'M'}${pt(i, v)}`).join(''), class: 'line-base' }));
  return scrub(f, { count, at: (i) => totals[i], onHover: (i) => onHover?.(i == null ? null : { month: months[i], parts: layers.map((l) => ({ id: l.id, label: l.label, valueKobo: l.values[i] })), totalKobo: totals[i] }, i), valueText: valueText && ((i) => valueText(i, totals[i])) });
}

/** Month-by-month bars of expected income against costs. windows: [{ from, to, incomeKobo, costsKobo }]. */
export function barChart({ windows, description, onHover, valueText }) {
  const count = windows.length;
  if (!count) return svg('svg', { viewBox: '0 0 640 240', class: 'chart', role: 'img', 'aria-label': description });
  const f = frame({ count: 2, firstDate: windows[0].from, lastDate: windows[count - 1].to, topValue: Math.max(...windows.map((w) => Math.max(w.incomeKobo, w.costsKobo)), 1), label: description });
  const { root, W, L, R, Y } = f, slot = (W - L - R) / count, bw = Math.min(22, slot * 0.36), base = Y(0);
  f.X = (i) => L + (i + 0.5) * slot; // bars sit in the middle of their slot (scrub reads this too)
  windows.forEach((w, i) => {
    const mid = f.X(i);
    if (w.incomeKobo > 0) root.append(svg('rect', { x: (mid - bw - 1).toFixed(1), y: Y(w.incomeKobo).toFixed(1), width: bw.toFixed(1), height: (base - Y(w.incomeKobo)).toFixed(1), rx: 3, class: 'bar bar-in' }));
    if (w.costsKobo > 0) root.append(svg('rect', { x: (mid + 1).toFixed(1), y: Y(w.costsKobo).toFixed(1), width: bw.toFixed(1), height: (base - Y(w.costsKobo)).toFixed(1), rx: 3, class: 'bar bar-out' }));
  });
  return scrub(f, { count, at: () => 0, dot: false, pick: (px) => Math.max(0, Math.min(count - 1, Math.floor((px - L) / slot))),
    onHover: (i) => onHover?.(i == null ? null : windows[i], i), valueText: valueText && ((i) => valueText(windows[i])) });
}

/** Screen-reader text for the cash flow bars. */
export function describeCashFlow(windows, money) {
  const inn = windows.reduce((t, w) => t + w.incomeKobo, 0), out = windows.reduce((t, w) => t + w.costsKobo, 0);
  return `Bar chart of expected regular income against costs for the next ${windows.length} months. In all, ${money(inn)} comes in and ${money(out)} goes out, following your saved payment plans. This is a projection, not a fact.`;
}
