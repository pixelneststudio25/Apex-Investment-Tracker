// Display helpers for the screens. Amounts honour the "hide amounts" setting.
import { formatNaira, formatNairaCompact, formatPercent } from '../engine/index.js';

let hidden = false;
export const setHidden = (v) => { hidden = !!v; };
export const isHidden = () => hidden;
export const HIDDEN_TEXT = '₦ ••••••';

export function money(kobo, { compact = true, sign = false } = {}) {
  if (hidden) return HIDDEN_TEXT;
  const body = compact ? formatNairaCompact(kobo) : formatNaira(kobo);
  return sign && kobo > 0 ? '+' + body : body;
}
export const pct = (fraction, opts) => formatPercent(fraction, opts);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }
export function fmtMonthYear(iso) { const [y, m] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function greeting(d = new Date()) { const hr = d.getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }
export const tone = (kobo) => (kobo > 0 ? 'gain' : kobo < 0 ? 'loss' : 'flat');
