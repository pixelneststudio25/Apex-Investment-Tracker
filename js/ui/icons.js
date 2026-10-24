// Line icons (1.5px stroke, 24px grid). Each icon is one SVG path string.
import { svg } from './dom.js';

const ring = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  sliders: `M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0${ring(15, 6, 2)}${ring(9, 12, 2)}${ring(17, 18, 2)}`,
  plus: 'M12 5v14M5 12h14',
  eye: `M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z${ring(12, 12, 3)}`,
  eyeOff: `M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM3 3l18 18`,
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 118 0v3',
  land: `M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z${ring(12, 10, 2.5)}`,
  house: 'M4 21V10l8-6 8 6v11zM10 21v-6h4v6',
  building: 'M5 21V4h9v17M14 9h5v12M9 8h1M9 12h1M9 16h1M3 21h18',
  car: 'M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16M3 16h18v3H3zM7 19v1.5M17 19v1.5',
  users: `${ring(9, 8, 3)}M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3 3 0 010 5.6M17 14.2c2.4.5 4 2.6 4 5.8`,
  handshake: `${ring(9.5, 12, 5)}${ring(14.5, 12, 5)}`,
  landmark: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  coins: 'M12 5c4.4 0 8 1.1 8 2.5S16.4 10 12 10 4 8.9 4 7.5 7.6 5 12 5zM4 7.5v4c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-4M4 11.5v4c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-4',
  sprout: 'M12 21v-9M12 12c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2-5-6-5 0 3 2 5 6 5z',
  wrench: 'M4 20l9-9M13 11a4 4 0 105-5l-2.5 2.5-2-.5-.5-2L16 3a4 4 0 00-3 8z',
  gem: 'M6 4h12l4 6-10 11L2 10zM2 10h20M9 4l-2 6 5 11 5-11-2-6',
  bitcoin: `${ring(12, 12, 9)}M10 8v8M10 8h3a2 2 0 010 4h-3M10 12h3.5a2 2 0 010 4H10`,
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7',
  frame: 'M4 4h16v16H4zM8 8h8v8H8z',
  piggy: 'M5 12a7 6 0 0114 0v3a3 3 0 01-3 3h-1v2h-3v-2h-2v2H7v-3.5A6 6 0 015 12zM16 10h.01',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  search: `${ring(11, 11, 7)}M21 21l-5-5`,
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  check: 'M5 12l5 5 9-10',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6zM9 12l2 2 4-4',
  key: `${ring(8, 15, 4)}M11 12l9-9M16 7l3 3M14 9l2 2`,
  clock: `${ring(12, 12, 9)}M12 7v5l3 2`,
  sun: `${ring(12, 12, 4)}M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4`,
  moon: 'M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z',
  x: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  alert: `${ring(12, 12, 9)}M12 8v5M12 16h.01`,
  info: `${ring(12, 12, 9)}M12 11v5M12 8h.01`,
  checkCircle: `${ring(12, 12, 9)}M8 12l3 3 5-6`,
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  backspace: 'M21 5H9l-6 7 6 7h12zM15 9l-4 4M11 9l4 4',
};

export const iconNames = Object.keys(PATHS);
export function icon(name, { size = 20, label } = {}) {
  return svg('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  }, svg('path', { d: PATHS[name] || PATHS.tag }));
}
