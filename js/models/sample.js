// A realistic sample portfolio (all invented). Used to try Apex before real records exist, and as a
// simulation for the tests: tests/scenarios.test.mjs checks the figures against an independent calculation.
// Every investment id is returned so the app can remove the sample later without touching real records.
import { scheduleEntries } from '../engine/index.js';

const N = (naira) => Math.round(naira * 100);
export const SAMPLE_AS_OF = '2026-10-23';

export async function seedSamplePortfolio(store, { asOf = SAMPLE_AS_OF } = {}) {
  const ids = { investments: [], partners: [] };
  const inv = async (data) => { const r = await store.create('investment', data); ids.investments.push(r.id); return r; };
  const entry = (investmentId, date, kind, naira, note = '', extra = {}) => store.create('entry', { investmentId, date, kind, amountKobo: N(naira), note, ...extra });
  const fromSchedule = async (s, kind) => { for (const e of scheduleEntries(s, asOf)) await store.create('entry', { investmentId: s.investmentId, date: e.date, kind, amountKobo: e.amountKobo, linkedScheduleId: s.id }); };

  // 1. Land: bought, costs, an agent's valuation later.
  const land = await inv({ name: 'Plot at Ibeju-Lekki', categoryId: 'land', openedOn: '2023-02-10',
    behaviors: { valueChange: 'appreciation' },
    rates: [{ type: 'assumed', rate: 0.19, rateUnit: 'year', method: 'compound', compoundsPerYear: 1, effectiveFrom: '2023-02-10', label: 'Expected growth' }],
    customFields: { location: 'Ibeju-Lekki, Lagos', plotSize: '600 sqm', titleDocument: 'C of O 2291/L', seller: 'Chief Adeyemi' },
    notes: 'Fenced in March 2023. Neighbours confirm the access road is being tarred.' });
  await entry(land.id, '2023-02-10', 'capital_in', 18000000, 'Purchase price');
  await entry(land.id, '2023-02-12', 'cost', 900000, 'Legal fees and deed of assignment');
  await entry(land.id, '2023-02-20', 'cost', 350000, 'Survey plan');
  await store.create('valuation', { investmentId: land.id, date: '2025-11-05', valueKobo: N(29500000), source: 'agent', note: 'Estate agent opinion of value' });

  // 2. Rental flat: rent every year with an increase, a yearly service charge, a recent comparable sale.
  const flat = await inv({ name: '3-bedroom flat, Yaba', categoryId: 'property-rental', openedOn: '2022-08-01',
    behaviors: { valueChange: 'appreciation', income: 'schedule' },
    rates: [{ type: 'assumed', rate: 0.08, rateUnit: 'year', method: 'compound', compoundsPerYear: 1, effectiveFrom: '2022-08-01' }],
    customFields: { address: '14 Herbert Macaulay Way, Yaba', propertyType: 'Flat', bedrooms: 3, tenant: 'Mrs Okafor' } });
  await entry(flat.id, '2022-08-01', 'capital_in', 42000000, 'Purchase price');
  await entry(flat.id, '2022-09-15', 'cost', 2800000, 'Renovation and painting');
  const rent = await store.create('schedule', { investmentId: flat.id, kind: 'income', label: 'Yearly rent', amountKobo: N(3600000), frequency: 'yearly', startDate: '2023-09-01',
    adjustments: [{ from: '2025-09-01', amountKobo: N(4200000) }] });
  await fromSchedule(rent, 'income');
  const service = await store.create('schedule', { investmentId: flat.id, kind: 'cost', label: 'Service charge', amountKobo: N(250000), frequency: 'yearly', startDate: '2023-01-15' });
  await fromSchedule(service, 'cost');
  await store.create('valuation', { investmentId: flat.id, date: '2026-06-01', valueKobo: N(58000000), source: 'comparable_sale', note: 'Similar flat in the same block sold' });

  // 3. Car rented out monthly (two months unpaid), depreciating.
  const car = await inv({ name: 'Toyota Camry 2019', categoryId: 'vehicle', openedOn: '2025-02-01',
    behaviors: { valueChange: 'depreciation', income: 'schedule' },
    rates: [{ type: 'assumed', rate: -0.15, rateUnit: 'year', method: 'compound', compoundsPerYear: 1, effectiveFrom: '2025-02-01', label: 'Depreciation' }],
    customFields: { make: 'Toyota', model: 'Camry', year: 2019, plateNumber: 'LND 412 KJA', driverOrRenter: 'Kunle (ride-hailing)' } });
  await entry(car.id, '2025-02-01', 'capital_in', 4000000, 'Purchase price');
  const carRent = await store.create('schedule', { investmentId: car.id, kind: 'income', label: 'Monthly rent', amountKobo: N(100000), frequency: 'monthly', startDate: '2025-03-01', skippedDates: ['2025-08-01', '2026-02-01'] });
  await fromSchedule(carRent, 'income');
  await entry(car.id, '2025-11-20', 'cost', 180000, 'Brake pads and service');

  // 4. Treasury bill that matured: closed, with proceeds.
  const bill = await inv({ name: 'FGN treasury bill, 364 days', categoryId: 'fixed-income', status: 'closed', openedOn: '2025-06-01', closedOn: '2026-05-31',
    behaviors: { valueChange: 'interest', term: { maturityDate: '2026-05-31' } },
    rates: [{ type: 'agreed', rate: 0.185, rateUnit: 'year', method: 'simple', effectiveFrom: '2025-06-01', label: 'Agreed rate' }],
    customFields: { institution: 'Stanbic IBTC', instrumentType: 'Treasury bill' } });
  await entry(bill.id, '2025-06-01', 'capital_in', 5000000, 'Placed');
  await entry(bill.id, '2026-05-31', 'proceeds', 5922465.75, 'Matured and paid out');

  // 5. Partnership with two friends: 50/30/20, two payouts, my own valuation.
  const ade = await store.create('partner', { name: 'Ade', note: 'Friend from university' });
  const bola = await store.create('partner', { name: 'Bola' });
  ids.partners.push(ade.id, bola.id);
  const venture = await inv({ name: 'Logistics van fleet (with Ade and Bola)', categoryId: 'partnership', openedOn: '2024-04-01',
    behaviors: { valueChange: 'manualOnly', income: 'irregular', ownership: 'shared' }, customFields: { venture: 'Last-mile delivery, 3 vans' } });
  await entry(venture.id, '2024-04-01', 'capital_in', 12000000, 'Three vans bought together');
  await entry(venture.id, '2024-12-20', 'payout', 900000, 'December share-out');
  await entry(venture.id, '2025-12-18', 'payout', 1500000, 'December share-out');
  await store.create('valuation', { investmentId: venture.id, date: '2026-09-30', valueKobo: N(15600000), source: 'own_estimate', note: 'Vans and contracts' });
  for (const [partnerId, percentage, c] of [['me', 5000, 6000000], [ade.id, 3000, 3600000], [bola.id, 2000, 2400000]]) {
    await store.create('ownership', { investmentId: venture.id, partnerId, percentage, contributionKobo: N(c), effectiveFrom: '2024-04-01' });
  }

  await store.create('reminder', { investmentId: flat.id, dueDate: '2026-11-15', text: 'Service charge invoice due', recurrence: 'yearly' });
  await store.create('reminder', { investmentId: land.id, dueDate: '2026-12-01', text: 'Ask the agent for an updated valuation', recurrence: 'none' });
  return ids;
}
