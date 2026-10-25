// Forms for single records (a ledger entry, a valuation, closing an investment), without any screen code.
// Each builder takes what the person typed and returns the fields to save, or throws InputError.
import { InputError, checkDate, parseNaira } from './inputs.js';
import { dayNumber } from '../engine/dates.js';

export const ENTRY_CHOICES = [
  ['capital_in', 'Money put in', 'More money you paid into this investment.'],
  ['cost', 'A cost', 'Fees, repairs, taxes, service charges.'],
  ['income', 'Income received', 'Rent or other income that reached you.'],
  ['payout', 'A payout received', 'A share-out from a business or partnership.'],
  ['repayment', 'A loan repayment', 'Money paid back to you on a loan you gave. It reduces what you are still owed.'],
  ['proceeds', 'Sale proceeds', 'Money you received from selling all or part of it.'],
];

export function buildEntry(form, investmentId) {
  const note = (form.note || '').trim();
  if (note.length > 1000) throw new InputError('The note can be at most 1000 characters.');
  if (!ENTRY_CHOICES.some(([k]) => k === form.kind)) throw new InputError('Choose what kind of entry this is.');
  return { investmentId, date: checkDate(form.date, 'The date'), kind: form.kind, amountKobo: parseNaira(form.amount), note };
}

export function buildValuation(form, investmentId) {
  const note = (form.note || '').trim();
  if (note.length > 1000) throw new InputError('The note can be at most 1000 characters.');
  return { investmentId, date: checkDate(form.date, 'The valuation date'), valueKobo: parseNaira(form.amount, { allowZero: true }), source: form.source, note };
}

// Closing: the investment becomes closed on that date. Money received from the sale is saved as a proceeds entry.
export function buildClose(form, investment) {
  const closedOn = checkDate(form.date, 'The closing date');
  if (dayNumber(closedOn) < dayNumber(investment.openedOn)) throw new InputError('The closing date cannot be before the start date.');
  const raw = (form.amount || '').trim();
  const proceedsKobo = raw === '' ? 0 : parseNaira(raw, { allowZero: true });
  const note = (form.note || '').trim();
  return {
    change: { status: 'closed', closedOn },
    proceeds: proceedsKobo > 0 ? { investmentId: investment.id, date: closedOn, kind: 'proceeds', amountKobo: proceedsKobo, note: note || 'Closing proceeds' } : null,
  };
}
