// Record schemas and validation (General System Plan section 6). `validate(type, data)` returns the cleaned
// fields or throws ModelError. Unknown fields are refused (a typo must never be stored silently), strings are
// trimmed, defaults are filled in, and money is always a whole number of kobo.
// Record-level fields (id, type, createdAt, updatedAt, deletedAt, schemaVersion) are added by the store.
import { dayNumber } from '../engine/dates.js';

export const RECORD_SCHEMA_VERSION = 1;
export const TYPES = ['settings', 'categoryTemplate', 'investment', 'entry', 'schedule', 'valuation', 'partner', 'ownership', 'document', 'reminder'];
export const ENTRY_KINDS = ['capital_in', 'cost', 'income', 'payout', 'proceeds', 'repayment'];
export const VALUE_CHANGES = ['none', 'appreciation', 'depreciation', 'interest', 'manualOnly'];
export const INCOME_MODES = ['none', 'schedule', 'irregular'];
export const OWNERSHIP_MODES = ['sole', 'shared'];
export const FREQUENCIES = ['monthly', 'quarterly', 'yearly', 'custom'];
export const VALUATION_SOURCES = ['own_estimate', 'agent', 'comparable_sale', 'bank', 'other'];
export const RATE_TYPES = ['assumed', 'agreed'];
export const META_KEYS = ['id', 'version', 'type', 'schemaVersion', 'createdAt', 'updatedAt', 'deletedAt'];

export class ModelError extends Error {
  constructor(field, message) { super(message); this.code = 'INVALID'; this.field = field; }
}
const bad = (path, msg) => { throw new ModelError(path, `${path ? path + ': ' : ''}${msg}`); };

// ---------- small parsers: (value, path) -> cleaned value ----------
const str = (max, { min = 1 } = {}) => (v, p) => {
  if (typeof v !== 'string') bad(p, 'must be text');
  const s = v.trim();
  if (s.length < min) bad(p, 'is required');
  if (s.length > max) bad(p, `must be at most ${max} characters`);
  return s;
};
const text = (max) => str(max, { min: 0 });
const ref = (v, p) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v.trim())) bad(p, 'must be a valid reference');
  return v.trim();
};
const date = (v, p) => {
  if (typeof v !== 'string') bad(p, 'must be a date (YYYY-MM-DD)');
  let n; try { n = dayNumber(v); } catch { bad(p, 'must be a real date (YYYY-MM-DD)'); }
  const year = Number(v.slice(0, 4));
  if (year < 1900 || year > 2200) bad(p, 'is outside the supported years (1900 to 2200)');
  return v;
};
const int = (min, max) => (v, p) => {
  if (!Number.isSafeInteger(v)) bad(p, 'must be a whole number');
  if (v < min || v > max) bad(p, `must be between ${min} and ${max}`);
  return v;
};
const kobo = (min = 0) => (v, p) => {
  if (!Number.isSafeInteger(v)) bad(p, 'must be a whole number of kobo');
  if (v < min) bad(p, min > 0 ? 'must be more than zero' : 'cannot be negative');
  return v;
};
const oneOf = (allowed) => (v, p) => { if (!allowed.includes(v)) bad(p, `must be one of: ${allowed.join(', ')}`); return v; };
const bool = (v, p) => { if (typeof v !== 'boolean') bad(p, 'must be true or false'); return v; };
const num = (limit) => (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(p, 'must be a number');
  if (Math.abs(v) > limit) bad(p, `must be between -${limit} and ${limit}`);
  return v;
};
const list = (parse, max) => (v, p) => {
  if (!Array.isArray(v)) bad(p, 'must be a list');
  if (v.length > max) bad(p, `can have at most ${max} items`);
  return v.map((x, i) => parse(x, `${p}[${i}]`));
};

const R = (parse) => ({ req: true, parse });
const O = (parse, def) => ({ req: false, parse, def });
const clean = (d) => (d !== null && typeof d === 'object' ? structuredClone(d) : d);

// obj({field: R(parse) | O(parse, default)}, check?) -> parser. Refuses unknown fields.
const obj = (fields, check) => (v, p = '') => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) bad(p, 'must be an object');
  const at = (k) => (p ? `${p}.${k}` : k);
  for (const k of Object.keys(v)) if (!(k in fields)) bad(at(k), 'is not a recognised field');
  const out = {};
  for (const [k, def] of Object.entries(fields)) {
    const raw = v[k];
    if (raw === undefined || raw === null) {
      if (def.req) bad(at(k), 'is required');
      out[k] = clean(def.def);
    } else out[k] = def.parse(raw, at(k));
  }
  if (check) check(out, p);
  return out;
};

// ---------- shared pieces ----------
const behaviors = obj({
  valueChange: R(oneOf(VALUE_CHANGES)),
  income: O(oneOf(INCOME_MODES), 'none'),
  ownership: O(oneOf(OWNERSHIP_MODES), 'sole'),
  term: O(obj({ maturityDate: R(date) }), null),
});

const rate = obj({
  type: R(oneOf(RATE_TYPES)),
  rate: R(num(10)), // a fraction per period: 0.12 = 12%, -0.15 = depreciation of 15%
  rateUnit: O(oneOf(['year', 'month']), 'year'),
  method: O(oneOf(['simple', 'compound']), 'simple'),
  compoundsPerYear: O(int(1, 365), null),
  effectiveFrom: O(date, null),
  effectiveTo: O(date, null),
  label: O(text(60), ''),
}, (r, p) => {
  if (r.method === 'simple' && r.compoundsPerYear !== null) bad(`${p}.compoundsPerYear`, 'only applies to compound rates');
  if (r.effectiveFrom && r.effectiveTo && dayNumber(r.effectiveTo) <= dayNumber(r.effectiveFrom)) bad(`${p}.effectiveTo`, 'must be after the start date');
});

const customFields = (v, p) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) bad(p, 'must be an object');
  const keys = Object.keys(v);
  if (keys.length > 50) bad(p, 'can have at most 50 fields');
  const out = {};
  for (const k of keys) {
    if (!/^[a-z][A-Za-z0-9_]{0,39}$/.test(k)) bad(`${p}.${k}`, 'field names must start with a lowercase letter and use letters, digits or _');
    const x = v[k];
    if (x === null) out[k] = null;
    else if (typeof x === 'number') out[k] = num(1e15)(x, `${p}.${k}`);
    else out[k] = text(500)(x, `${p}.${k}`);
  }
  return out;
};

const fieldDef = obj({
  key: R(str(40)), label: R(str(60)), type: O(oneOf(['text', 'number', 'date', 'url']), 'text'),
}, (d, p) => { if (!/^[a-z][A-Za-z0-9_]{0,39}$/.test(d.key)) bad(`${p}.key`, 'must start with a lowercase letter and use letters, digits or _'); });

const noOverlap = (rates, p) => {
  const span = (r) => [r.effectiveFrom ? dayNumber(r.effectiveFrom) : -Infinity, r.effectiveTo ? dayNumber(r.effectiveTo) : Infinity];
  for (let i = 0; i < rates.length; i++) {
    for (let j = i + 1; j < rates.length; j++) {
      const [af, at] = span(rates[i]), [bf, bt] = span(rates[j]);
      if (af < bt && bf < at) bad(`${p}[${j}]`, 'overlaps another rate. Give each rate its own dates so only one applies on any day');
    }
  }
};

// ---------- record types ----------
const SCHEMAS = {
  settings: obj({
    displayName: O(text(80), ''), portfolioName: O(text(80), ''),
    theme: O(oneOf(['system', 'light', 'dark']), 'system'),
    lockTimeoutMin: O(oneOf([0, 1, 2, 5, 15]), 2), // 0 = lock when the app is closed
    textScale: O(oneOf([90, 100, 115, 130]), 100),
    hideAmounts: O(bool, false), haptics: O(bool, false),
    defaultHorizons: O(list(oneOf(['1M', '6M', '1Y', '5Y']), 8), ['1M', '6M', '1Y', '5Y']),
  }),

  categoryTemplate: obj({
    name: R(str(60)), icon: O(str(40), 'tag'),
    defaultBehaviors: R(behaviors), customFieldDefs: O(list(fieldDef, 30), []),
  }),

  investment: obj({
    name: R(str(120)), categoryId: R(ref), status: O(oneOf(['active', 'closed']), 'active'),
    openedOn: R(date), closedOn: O(date, null), notes: O(text(5000), ''),
    behaviors: R(behaviors), rates: O(list(rate, 20), []),
    customFields: O(customFields, {}), coverImageRef: O(str(200), null),
  }, (v) => {
    if (v.status === 'active' && v.closedOn) bad('closedOn', 'an active investment cannot have a closing date');
    if (v.closedOn && dayNumber(v.closedOn) < dayNumber(v.openedOn)) bad('closedOn', 'cannot be before the opening date');
    if (v.behaviors.term && dayNumber(v.behaviors.term.maturityDate) < dayNumber(v.openedOn)) bad('behaviors.term.maturityDate', 'cannot be before the opening date');
    if (v.rates.length && (v.behaviors.valueChange === 'none' || v.behaviors.valueChange === 'manualOnly')) {
      bad('rates', 'rates need a value change of appreciation, depreciation or interest');
    }
    noOverlap(v.rates, 'rates');
  }),

  entry: obj({
    investmentId: R(ref), date: R(date), kind: R(oneOf(ENTRY_KINDS)),
    amountKobo: R(kobo(1)), // always positive; the kind says which way the money moved
    note: O(text(1000), ''), partnerId: O(ref, null), linkedScheduleId: O(ref, null),
    documentIds: O(list(ref, 20), []),
  }),

  schedule: obj({
    investmentId: R(ref), kind: O(oneOf(['income', 'cost']), 'income'), label: O(text(120), ''),
    amountKobo: R(kobo(1)), frequency: R(oneOf(FREQUENCIES)), everyDays: O(int(1, 3650), null),
    startDate: R(date), endDate: O(date, null),
    adjustments: O(list(obj({ from: R(date), amountKobo: R(kobo(1)) }), 100), []),
    skippedDates: O(list(date, 1000), []), status: O(oneOf(['active', 'ended']), 'active'),
  }, (v) => {
    if (v.frequency === 'custom' && v.everyDays === null) bad('everyDays', 'is required for a custom frequency');
    if (v.frequency !== 'custom' && v.everyDays !== null) bad('everyDays', 'only applies to a custom frequency');
    if (v.endDate && dayNumber(v.endDate) < dayNumber(v.startDate)) bad('endDate', 'cannot be before the start date');
    v.adjustments.sort((a, b) => dayNumber(a.from) - dayNumber(b.from));
    v.skippedDates = [...new Set(v.skippedDates)].sort();
  }),

  valuation: obj({
    investmentId: R(ref), date: R(date), valueKobo: R(kobo(0)),
    source: O(oneOf(VALUATION_SOURCES), 'own_estimate'), note: O(text(1000), ''),
  }),

  partner: obj({ name: R(str(80)), note: O(text(1000), '') }),

  ownership: obj({
    investmentId: R(ref), partnerId: R(ref), // 'me' or a partner record id
    contributionKobo: R(kobo(0)), percentage: R(int(1, 10000)), // basis points: 10000 = 100%
    effectiveFrom: O(date, null), effectiveTo: O(date, null),
  }, (v) => {
    if (v.effectiveFrom && v.effectiveTo && dayNumber(v.effectiveTo) <= dayNumber(v.effectiveFrom)) bad('effectiveTo', 'must be after the start date');
  }),

  document: obj({
    investmentId: R(ref), filename: R(str(200)), mime: O(text(100), ''), size: R(int(0, 10 * 1024 * 1024)),
    storagePath: R(str(300)), uploadedOn: R(date), label: O(text(120), ''),
    entryId: O(ref, null), // optional: the ledger entry this file backs up (a receipt, an agreement)
  }),

  reminder: obj({
    investmentId: O(ref, null), dueDate: R(date), text: R(str(300)),
    recurrence: O(oneOf(['none', 'monthly', 'quarterly', 'yearly']), 'none'), done: O(bool, false),
  }),
};

export function validate(type, data) {
  const schema = SCHEMAS[type];
  if (!schema) throw new ModelError('type', `Unknown record type: ${type}`);
  return schema(data, '');
}

// The user-editable fields of a stored record (everything except the record-level fields).
export function fieldsOf(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) if (!META_KEYS.includes(k)) out[k] = v;
  return out;
}
