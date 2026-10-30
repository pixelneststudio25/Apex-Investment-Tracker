// Everything the Help section says, as data. No HTML and no DOM here: js/ui/help.js turns this into screens,
// and tests/help.test.mjs checks that every link, term and question points at something that exists.
//
// Writing rules (kept from the rest of the app): plain words, no contractions, no em dashes, naira with the sign.
// Examples are Nigerian and ordinary: a plot, a rented flat, a treasury bill, thrift (ajo).
import { formatNaira, formatPercent, investmentMetrics } from '../engine/index.js';

const N = (naira) => Math.round(naira * 100);

// ---------- the one worked example, calculated by the real engine so the Help can never drift from the app ----------
// A rented flat: ₦10,000,000 paid, ₦500,000 of legal fees, one year of rent received, valued by the owner at ₦12,500,000.
export const EXAMPLE = (() => {
  const asOf = '2026-10-23';
  const entries = [
    { date: '2024-10-23', kind: 'capital_in', amountKobo: N(10000000) },
    { date: '2024-11-04', kind: 'cost', amountKobo: N(500000) },
    { date: '2025-10-23', kind: 'income', amountKobo: N(1200000) },
  ];
  const valuations = [{ date: '2026-10-01', valueKobo: N(12500000), source: 'own_estimate' }];
  const investment = { openedOn: '2024-10-23', status: 'active', behaviors: { valueChange: 'manualOnly' }, rates: [] };
  const m = investmentMetrics({ investment, entries, valuations, asOf });
  const f = (kobo) => formatNaira(kobo);
  return {
    asOf, m, entries, valuations,
    text: {
      invested: f(m.investedKobo), costs: f(m.costsKobo), income: f(m.incomeKobo), worth: f(m.valueKobo), net: f(m.netGainKobo),
      basis: f(m.investedKobo + m.costsKobo), roi: formatPercent(m.roi), annualized: formatPercent(m.annualized.rate), days: String(m.daysHeld),
    },
  };
})();
const X = EXAMPLE.text;

// ---------- where "Try it now" and the sample portfolio can point ----------
export const STATIC_ROUTES = Object.freeze(['#/', '#/investments', '#/new', '#/settings', '#/help', '#/outlook', '#/export', '#/categories']);
export const RECORD_KINDS = Object.freeze(['entry', 'valuation', 'close']); // #/investments/<id>/<kind>, see js/ui/forms.js
export const TRY_ACTIONS = Object.freeze(['palette']);
// The sample portfolio is created in this order (js/models/sample.js), and its ids are kept in order in the store.
export const SAMPLE_INVESTMENTS = Object.freeze({
  land: { index: 0, name: 'Plot at Ibeju-Lekki' },
  flat: { index: 1, name: '3-bedroom flat, Yaba' },
  car: { index: 2, name: 'Toyota Camry 2019' },
  bill: { index: 3, name: 'FGN treasury bill, 364 days' },
  venture: { index: 4, name: 'Logistics van fleet (with Ade and Bola)' },
});

// The ledger words used by the mock-ups. They match the Ledger tab in js/ui/workspace.js.
export const LEDGER_KINDS = Object.freeze({
  capital_in: ['Money put in', -1], cost: ['Cost', -1], income: ['Income received', 1], payout: ['Payout received', 1], proceeds: ['Sale proceeds', 1], repayment: ['Loan repayment', 1],
});

export const HELP_HOME = Object.freeze({
  title: 'How to use Apex',
  lead: 'Short guides in plain words. Pick a topic, follow the steps, then try it on the real screen.',
  startId: 'start',
  searchHint: 'Looking for a word or a question? Search finds every topic, term and answer here.',
});

// ---------- topics ----------
// step: { title, text, more? }  more = another topic id, shown as a "Read more" link
// tryIt: { label, route } | { label, record } | { label, detail: true } | { label, action }, plus optional fallbackLabel, fallbackNote
// mock: what the little picture shows (drawn with the app's own components in help.js)
export const TOPICS = Object.freeze([
  {
    id: 'start', title: 'Your first 5 minutes', icon: 'flag', tint: 1,
    summary: 'The short path from an empty Apex to a portfolio you can trust.',
    lead: 'Five small jobs, in this order. Each one takes about a minute, and the Getting started card on Home ticks them off for you as you go.',
    mock: { type: 'checklist', done: 2 },
    steps: [
      { title: 'Add one investment', text: 'Choose a category such as Land or Property (rental), give it a name and the date you started, and enter the money you put in. Apex asks only the steps that fit the category.', more: 'add-investment' },
      { title: 'Record what it is worth today', text: 'Add a valuation, which is your latest honest figure for the asset. A figure you enter always beats an assumption, so Apex shows a real number.', more: 'valuations-rates' },
      { title: 'Log income or a cost', text: 'Rent that reached you, a service charge, a legal fee. Every one of these feeds your returns.', more: 'income-costs' },
      { title: 'Set a PIN', text: 'Four digits that unlock Apex on this device instead of your password. Find it in Settings under Security.', more: 'privacy' },
      { title: 'Save and check your recovery key', text: 'Keep the recovery key you were shown at signup somewhere safe, then use Check my recovery key in Settings to confirm it really works.', more: 'privacy' },
    ],
    tryIt: { label: 'Add your first investment', route: '#/new' },
    goodToKnow: 'You can do these in any order, and you can hide the Getting started card once you are comfortable. It stays on this device only.',
    glossary: ['valuation', 'recovery-key'], faq: ['lose-key'],
    sample: { key: 'land', text: 'Not ready to enter real records? Add the sample portfolio first and look around. It is made up, and you can remove it in one tap.' },
    keywords: 'begin beginner onboarding getting started checklist setup first time',
  },
  {
    id: 'add-investment', title: 'Adding an investment', icon: 'plus', tint: 2,
    summary: 'The step-by-step form, and what each step is asking for.',
    lead: 'Adding an investment is a short guided form. You can go back at any step, and nothing is saved until the last one.',
    mock: { type: 'categories', ids: ['land', 'property-rental', 'vehicle', 'fixed-income', 'partnership', 'cooperative-thrift'], selected: 'land' },
    steps: [
      { title: 'Choose the kind', text: 'Land, a rented property, a vehicle, a treasury bill, a partnership, a thrift group and more. The kind only sets sensible starting answers. You can change any of them.' },
      { title: 'Give it a name and a start date', text: 'Use a name you will recognise later, such as Plot at Ibeju-Lekki. The start date is the day the money went in.' },
      { title: 'Add the details that matter', text: 'Some categories ask for extras, for example a title document number for land or a plate number for a vehicle. Fill what you have and skip the rest.' },
      { title: 'Enter the money you put in', text: 'Type the amount, for example 18000000. Apex shows back exactly what it understood underneath, such as = ₦18,000,000.00, so you can catch a slip before it is saved.' },
      { title: 'Say how its value changes', text: 'Pick Grows in value, Loses value, Earns interest, I will update the value myself, or Stays at what I paid. For the first three you can set a yearly or monthly rate, simple or compounded. You can also enter what it is worth today.', more: 'valuations-rates' },
      { title: 'Say what income it pays', text: 'Choose No income, Regular payments or Now and then. For regular payments, enter the amount and how often, and you can record the payments already due as received in one go.', more: 'income-costs' },
      { title: 'Check and save', text: 'The last step is a summary. Tap Change beside any heading to go back and fix that part, then save.' },
    ],
    tryIt: { label: 'Add an investment', route: '#/new' },
    goodToKnow: 'If you leave halfway, Apex asks before throwing away what you typed. Shared investments get one extra step, Who shares it.',
    glossary: ['invested', 'assumed-rate', 'agreed-rate', 'simple-compound', 'regular-payment'], faq: ['at-cost'],
    sample: { key: 'flat', text: 'The 3-bedroom flat in Yaba in the sample portfolio was set up this way: a purchase price, renovation costs, yearly rent and a growth rate.' },
    keywords: 'new create add wizard form category land property vehicle',
  },
  {
    id: 'numbers', title: 'Reading your numbers', icon: 'calculator', tint: 3,
    summary: 'Worth, net gain, return, annualized return, and how each one is worked out.',
    lead: `Every figure on an investment comes from the same few ingredients: money put in, costs, income and worth. Here is one example you can follow with a pen. A flat bought for ${X.invested}, ${X.costs} of legal fees, ${X.income} of rent received, and valued at ${X.worth} today.`,
    mock: { type: 'statement' },
    steps: [
      { title: 'Worth today', text: 'The big figure. Apex uses your latest valuation exactly as entered. With no valuation it grows the money put in at your rate over the actual days. With neither, it shows what you paid. For a closed investment it shows what you sold for.', more: 'valuations-rates' },
      { title: 'Net gain', text: `Worth plus income received, minus money put in and costs. Here: ${X.worth} + ${X.income} − ${X.invested} − ${X.costs} = ${X.net}.` },
      { title: 'Return on investment', text: `Net gain divided by money put in plus costs. Here: ${X.net} ÷ ${X.basis} = ${X.roi}. It ignores time, so it cannot tell a quick win from a slow one.` },
      { title: 'Annualized return', text: `The yearly rate that matches what actually happened, counted over ${X.days} actual days with years as days ÷ 365. Here it comes to ${X.annualized} a year. It uses CAGR for one lump sum with nothing else, and XIRR whenever money moved on several dates. Under a year held, treat it as a rough guide.` },
      { title: 'Income yield', text: 'Income and payouts of the last 12 months, minus costs, divided by everything put in. It appears only when there was income or a cost in that period.' },
    ],
    tryIt: { label: 'Open an investment', detail: true, fallbackLabel: 'Add an investment first', fallbackNote: 'There is nothing to read yet. Add an investment, or try the sample portfolio.' },
    goodToKnow: 'On every investment, the section called How this is calculated writes these same sums out with your own figures.',
    glossary: ['worth', 'net-gain', 'roi', 'annualized', 'cagr', 'xirr', 'income-yield', 'kobo'], faq: ['annualized-missing', 'at-cost'],
    sample: { key: 'flat', text: 'Open the 3-bedroom flat in Yaba, then read How this is calculated at the bottom of its Overview.' },
    keywords: 'return roi gain math formula calculate percent annualized cagr xirr worth',
  },
  {
    id: 'income-costs', title: 'Income and costs', icon: 'receipt', tint: 4,
    summary: 'Recording rent, payouts and expenses so your returns are honest.',
    lead: 'Returns are only as good as the ledger behind them. The ledger is the dated list of every payment into or out of an investment.',
    mock: {
      type: 'ledger',
      rows: [
        { date: '2026-09-01', kind: 'income', note: 'Yearly rent', amount: N(4200000) },
        { date: '2026-01-15', kind: 'cost', note: 'Service charge', amount: N(250000) },
        { date: '2025-09-01', kind: 'income', note: 'Yearly rent', amount: N(3600000) },
        { date: '2022-08-01', kind: 'capital_in', note: 'Purchase price', amount: N(42000000) },
      ],
    },
    steps: [
      { title: 'Open the investment and tap Add entry', text: 'Entries live on the investment, so open it first. You can also use the Entry shortcut on Home.' },
      { title: 'Choose what kind of entry it is', text: 'Money put in, a cost, income received, a payout received or sale proceeds. The kind decides how the amount is counted in your figures.' },
      { title: 'Enter the date and the amount', text: 'Use the date the money actually moved. Add a short note, such as Repairs to the roof, so you remember later.' },
      { title: 'Read the ledger', text: 'Newest first. Money leaving you shows as minus and money reaching you shows as plus. Open any entry to edit it or delete it.' },
      { title: 'Use regular payments for repeating money', text: 'For yearly rent or a monthly charge, set a regular payment. Apex works out when each is due and lists it under Coming up on Home. It counts in your returns only after you record it as received.', more: 'valuations-rates' },
    ],
    tryIt: { label: 'Add an entry', record: 'entry', fallbackLabel: 'Add an investment first', fallbackNote: 'Entries belong to an investment. Add one first, or try the sample portfolio.' },
    goodToKnow: 'Rent that is due is not rent that has arrived. If a tenant is late, simply leave it unrecorded until the money reaches you.',
    glossary: ['ledger', 'regular-payment', 'payout', 'proceeds', 'invested', 'thrift'], faq: ['rent-missing', 'loan-repay', 'edit-saved', 'thrift'],
    sample: { key: 'car', text: 'The Toyota Camry in the sample portfolio is rented monthly and has two months left unpaid, so you can see how a gap looks.' },
    keywords: 'rent income cost expense ledger entry payout service charge repairs',
  },
  {
    id: 'valuations-rates', title: 'Valuations versus rates', icon: 'balance', tint: 5,
    summary: 'Two ways to say what something is worth, and which one wins.',
    lead: 'A valuation is a figure you record on a date. A rate is a yearly percentage you expect or have agreed. They answer the same question, so Apex needs a rule for when both exist.',
    mock: {
      type: 'worth',
      rows: [
        { n: 1, title: 'Your latest valuation', text: 'Used exactly as entered, from the date you entered it.', badge: 'Wins' },
        { n: 2, title: 'Your rate', text: 'Money put in, grown or reduced over the actual days.', badge: 'If no valuation' },
        { n: 3, title: 'What you paid', text: 'Shown when there is no valuation and no rate.', badge: 'Last resort' },
      ],
    },
    steps: [
      { title: 'Use a rate when you only have an expectation', text: 'An assumed rate, chosen as My own assumption, is your own estimate. For example, 19% a year for land in an area you know. It is a guess you can change at any time.' },
      { title: 'Use an agreed rate when someone has promised it', text: 'A treasury bill, a fixed deposit or a loan you gave has a rate set in the paperwork. Choose Agreed with someone as the rate source, so you can tell it apart from a guess.' },
      { title: 'Choose simple or compound', text: 'Simple pays the same amount each year on what you first put in. Compound lets gains earn gains. Over 3 years (1,095 days) at 10% a year, ₦1,000,000 becomes ₦1,300,000 simple or ₦1,331,000 compounded.' },
      { title: 'Add a valuation when you learn the real figure', text: 'An agent opinion, a bank statement, a comparable sale or your own estimate. Say where it came from. From that date, Apex uses it instead of the rate.' },
      { title: 'Remember a valuation is not stretched forward', text: 'After a valuation, the worth stays at that figure until you add a newer one. It does not keep growing at your rate.' },
    ],
    tryIt: { label: 'Add a valuation', record: 'valuation', fallbackLabel: 'Add an investment first', fallbackNote: 'A valuation belongs to an investment. Add one first, or try the sample portfolio.' },
    goodToKnow: 'Rates can be per year or per month, and a negative rate means the asset loses value, which suits a car or equipment.',
    glossary: ['valuation', 'assumed-rate', 'agreed-rate', 'simple-compound', 'worth'], faq: ['valuation-ignores-rate', 'at-cost'],
    sample: { key: 'land', text: 'The plot at Ibeju-Lekki has an expected growth rate and later an agent valuation. Check how its worth is explained on the Overview.' },
    keywords: 'valuation rate interest growth depreciation assumed agreed simple compound worth value',
  },
  {
    id: 'shared', title: 'Shared investments', icon: 'users', tint: 6,
    summary: 'Recording what you own with friends, and what each of you has earned.',
    lead: 'When you invest with others, Apex tracks each person share so you can see your own position, not just the total.',
    mock: { type: 'people', worth: N(15600000), rows: [{ who: 'You', put: N(6000000), bp: 5000 }, { who: 'Ade', put: N(3600000), bp: 3000 }, { who: 'Bola', put: N(2400000), bp: 2000 }] },
    steps: [
      { title: 'Choose a category that is shared', text: 'On The basics step, under Who owns it, choose Shared with other people. The Partnership category is shared from the start.' },
      { title: 'Add the people', text: 'On the Who shares it step, add each partner by name. You are always included as You.' },
      { title: 'Enter each share and what each person put in', text: 'Shares are percentages and must total exactly 100%. Contributions are the naira each person paid in.' },
      { title: 'Record the payouts', text: 'Each time the venture shares out money, add a payout received for the total. Apex splits it by share, to the exact kobo.' },
      { title: 'Open the People tab', text: 'It shows each person put in, share, worth, income and net gain. Under it, Apex states your own position after what you put in.' },
    ],
    tryIt: { label: 'Add a shared investment', route: '#/new' },
    goodToKnow: 'If shares do not add up to 100%, Apex stops and tells you rather than guessing. Fix the percentages and it will carry on.',
    glossary: ['ownership-share', 'payout', 'net-gain'], faq: [],
    sample: { key: 'venture', text: 'The logistics van fleet in the sample portfolio is split 50, 30 and 20 between you, Ade and Bola.' },
    keywords: 'partner partnership friends share percentage split people ownership',
  },
  {
    id: 'closing', title: 'Closing, reopening and deleting', icon: 'undo', tint: 1,
    summary: 'What each one does, and how Undo can save you.',
    lead: 'These three sound alike but do different things. Closing says the investment is over. Reopening takes that back. Deleting hides the whole investment.',
    mock: { type: 'toast', text: '“3-bedroom flat, Yaba” deleted.', action: 'Undo' },
    steps: [
      { title: 'Close when you sell or cash out', text: 'Choose Close, enter the closing date, and enter what you received. Apex saves that as sale proceeds in the ledger. From then on the figure shown is what you sold for, and the clock stops on the closing date.' },
      { title: 'Reopen if you closed by mistake', text: 'Reopen this investment brings it back to active. Any proceeds you recorded stay in the ledger, so delete them there if they no longer apply.' },
      { title: 'Delete only to remove it entirely', text: 'Delete hides the investment and everything recorded under it. You are asked to confirm first.' },
      { title: 'Tap Undo straight away', text: 'After a delete, a message appears with Undo for about nine seconds. The same goes for a single entry or valuation you delete. After that the app cannot bring it back.' },
    ],
    tryIt: { label: 'Close an investment', record: 'close', fallbackLabel: 'Add an investment first', fallbackNote: 'Only an active investment can be closed. Add one first, or try the sample portfolio.' },
    goodToKnow: 'Closing keeps your history and your returns. Deleting removes them from view. When in doubt, close.',
    glossary: ['closed', 'proceeds'], faq: ['deleted-by-mistake'],
    sample: { key: 'bill', text: 'The treasury bill in the sample portfolio is closed. Open it to see how a finished investment looks.' },
    keywords: 'close sold sale reopen delete remove undo restore trash',
  },
  {
    id: 'privacy', title: 'Privacy and security', icon: 'shield', tint: 2,
    summary: 'PIN, auto-lock, recovery key, hiding amounts, and what stays on your device.',
    lead: 'Your records are encrypted with a key only you hold. That is what keeps them private, and it is also why a lost recovery key cannot be fixed by anyone.',
    mock: {
      type: 'iconRows',
      rows: [
        { icon: 'lock', title: 'Locks by itself', text: 'After 2 minutes of inactivity, or the time you choose in Settings.' },
        { icon: 'key', title: 'PIN on this device', text: 'Four digits instead of your password.' },
        { icon: 'shield', title: 'Recovery key', text: 'The only way back in if all else fails.' },
        { icon: 'eye', title: 'Hide amounts', text: 'Blurs every naira figure on screen.' },
      ],
    },
    steps: [
      { title: 'Set a PIN', text: 'In Settings, under Security, choose Set or change PIN. It unlocks Apex on this device only. After 5 wrong tries the PIN is removed from the device, and you sign in with your password again.' },
      { title: 'Let it lock itself', text: 'Apex locks after 2 minutes of inactivity (you can change this in Settings, under Security), and also if you leave the app or tab for that long. Use Lock now whenever you step away.' },
      { title: 'Keep your recovery key safe', text: 'It was shown once at signup. Apex keeps no copy. Store it somewhere you will find in years, such as a printout or a password manager.' },
      { title: 'Check the key', text: 'Choose Check my recovery key in Settings, and enter the key you saved. Apex tells you if it opens your data. It changes nothing.' },
      { title: 'Hide amounts in public', text: 'Tap the eye at the top, or search for Hide amounts. Naira figures blur while percentages stay visible, which is handy on a bus or at a meeting.' },
      { title: 'Know where your records are', text: 'Records are encrypted on this device and a locked copy is backed up online, so you can open Apex on another device. Check the status at the top of the screen, or open Settings and choose Check my backup. Your recovery key still matters: it is the only way back in if you forget your password.' },
    ],
    tryIt: { label: 'Open Settings', route: '#/settings' },
    goodToKnow: 'Create a new recovery key from Settings if you ever think the old one has been seen. The new one replaces it straight away, so save it at once.',
    glossary: ['recovery-key'], faq: ['lose-key', 'pin-removed', 'other-device'],
    sample: null,
    keywords: 'pin lock secure password recovery key hide amounts encrypted privacy device sync',
  },
  {
    id: 'shortcuts', title: 'Shortcuts and search', icon: 'command', tint: 3,
    summary: 'Jump anywhere, or do almost anything, from one box.',
    lead: 'Search is the fastest way around Apex. It finds your investments, pages, actions and every Help topic.',
    mock: {
      type: 'palette', query: 'yaba',
      results: [{ icon: 'house', label: '3-bedroom flat, Yaba', sub: 'Property (rental)' }, { icon: 'plus', label: 'Add an investment', sub: '' }],
    },
    steps: [
      { title: 'Open it', text: 'Press Ctrl and K together (⌘K on a Mac), or tap the search button. On a phone, tap the magnifying glass at the top.' },
      { title: 'Type a few letters', text: 'A name, a page or a word such as lock, rent or recovery. The best matches come first.' },
      { title: 'Move and choose', text: 'Arrow keys move up and down, Enter opens the highlighted result, and Esc closes the box. On a phone, simply tap a result.' },
      { title: 'Use it for actions too', text: 'Add an investment, hide amounts, switch theme, lock Apex, set a PIN or check your recovery key, all without hunting through screens.' },
      { title: 'Search the Help', text: 'Type a word such as ROI, XIRR or recovery key and the matching topic, term or answer appears under Help.' },
    ],
    tryIt: { label: 'Open search now', action: 'palette' },
    goodToKnow: 'The shortcut will not open while you are in the middle of a form, so you never lose what you were typing.',
    glossary: [], faq: [],
    sample: null,
    keywords: 'search palette command keyboard shortcut ctrl k jump find',
  },
  {
    id: 'projections-export', title: 'Looking ahead (Outlook), exporting and printing', icon: 'chart', tint: 5,
    summary: 'Try a what-if rate, download your records for a spreadsheet, or print a clean statement.',
    lead: 'Three things for when you want to look past today or hand your figures to someone else. A projection is a what-if and never a fact. Files and statements are plain copies of what you already recorded.',
    mock: { type: 'statement' },
    steps: [
      { title: 'Open Outlook', text: 'Choose Outlook in the bottom bar, or choose Look ahead on Home or on an open investment. Outlook shows everything you hold, and Look ahead on a single investment shows just that one. Closed investments have nothing left to project.' },
      { title: 'Pick how far ahead', text: 'Choose 1, 3, 5 or 10 years, or Custom for any whole number up to 50. The answer changes the moment you choose, with no button to press.' },
      { title: 'See what each investment assumes', text: 'Under Assumptions, each open investment shows the rate it uses and where it came from: Saved, Edited, or None. An investment with no saved rate is held at its worth today and named, never guessed. Tap one to try a different rate. Nothing real changes, and Reset puts the saved rate back.' },
      { title: 'Try Cautious, Base or Optimistic', text: 'Cautious moves every growth rate three points lower and Optimistic three points higher. You can also type your own number of points. Investments with no rate stay flat.' },
      { title: 'Keep what you try', text: 'Your edited rates, the years, the scenario and your inflation figure are remembered for you automatically, encrypted like everything else, and they are there on your other devices too. To keep a set for later, type a name under Saved scenarios and choose Save these choices. You can keep up to 5, and Load or Delete them any time. Only your choices are saved, never a result.' },
      { title: 'Real terms, and your own share', text: 'Turn on Real terms and type a yearly inflation figure of your choosing to see every future amount in present-day naira. Apex does not pick the figure for you. If you share investments, choose Full value or My share.', more: 'valuations-rates' },
      { title: 'Put your dates in a calendar', text: 'Under Export and print, Calendar makes a file of your reminders and the payments your saved plans expect, as all-day dates, for the next 3, 6 or 12 months. Open it on your phone or computer and your calendar app offers to add them. Opening the same kind of file again updates the dates instead of doubling them. By default a payment shows only as Payment expected, with no amount or investment name, because calendar apps often sync to a cloud service. The file is not encrypted.' },
      { title: 'Read the answer as a what-if', text: 'Everything on Outlook is marked Projection. It starts from what each investment is worth today and uses the rates shown. A term investment stops growing on its maturity date. Regular payments you set up, such as rent, are included from tomorrow on. Payments already due but not recorded are never counted, because Apex does not assume money arrived.', more: 'income-costs' },
      { title: 'Download your records', text: 'Under Export and print, download the ledger, the valuations or a summary as a CSV file. Amounts are plain naira with two decimals, and money leaving you is minus.' },
      { title: 'Print a statement', text: 'Open the statement, choose a date, and use Print or save as PDF. You can include every entry and valuation, or print one investment on its own. Amounts must be showing, so turn off Hide amounts first.' },
    ],
    tryIt: { label: 'Open Outlook', route: '#/outlook' },
    goodToKnow: 'A downloaded file is not encrypted. Your records inside Apex are, but a file on your phone or computer is plain text, so keep it somewhere private. Nothing you try in Outlook changes your real figures.',
    glossary: ['projection'], faq: [],
    sample: null,
    keywords: 'projection forecast what if future scenario export csv spreadsheet excel download print statement pdf report',
  },
  {
    id: 'documents', title: 'Keeping documents with an investment', icon: 'doc', tint: 4,
    summary: 'Attach a contract, receipt or title deed. It is locked on your device before it is stored.',
    lead: 'Keep the papers for an investment next to its numbers. Each file is locked on your own device with your key before it is uploaded, so nobody else can read it, including the server.',
    mock: null,
    steps: [
      { title: 'Open the investment', text: 'Go to the investment and find Documents on the Overview tab. Choose Add. Closed investments keep their documents, but you cannot add new ones until you reopen it.' },
      { title: 'Choose a file', text: 'Tap the file area, or drop a file onto it on a computer. A PDF, a photo, a text file, or a Word, Excel or CSV file all work, up to 10 MB each. An investment can hold 20 documents.' },
      { title: 'Give it a label', text: 'A label such as Tenancy agreement 2026 is shown instead of the file name. It is optional, and you can change it later.' },
      { title: 'Link it to one entry if it fits', text: 'A receipt can be tied to the cost it proves, and a rent agreement to the first rent you received. Pick the entry from the list, or leave it unlinked. Entries with a document show a small paperclip in the ledger.', more: 'income-costs' },
      { title: 'Watch the four steps', text: 'Apex shows what it is doing: reading the file, locking it, uploading it, then saving the record. If something fails, the step that failed is marked and nothing is left half saved.' },
      { title: 'Preview, download or open it later', text: 'Open a document to look at it. Photos and text files show inside Apex, a PDF opens in a new tab, and any file can be downloaded. You can also change its label or link there.', more: 'closing' },
      { title: 'Delete it, or delete it forever', text: 'Delete hides a document, and you can undo it straight away or restore it from Recently deleted. To remove the file for good, use Delete forever in Recently deleted. The locked file is erased from the server and from every device, and this cannot be undone.' },
      { title: 'Back the files up', text: 'In Settings, Documents backup saves one file holding all your documents, still locked, and can put them back later. Your normal backup file only holds the records that point to them.' },
    ],
    tryIt: { label: 'Open Investments', route: '#/investments' },
    goodToKnow: 'Adding, opening or deleting a document for good needs an internet connection, because the locked file lives on the server. Older versions of a record, with its file name, stay in your locked history after a document is deleted forever. Only your key can open them.',
    glossary: [], faq: ['documents-offline'],
    sample: null,
    keywords: 'document file upload attach receipt contract title deed agreement pdf photo paperclip entry vault download preview delete forever backup',
  },
  {
    id: 'categories', title: 'Making your own category', icon: 'tag', tint: 3,
    summary: 'Add a kind of investment Apex does not have, with its own starting answers and extra details.',
    lead: 'A category is a starting point for new investments: how its value changes, what income it pays, who owns it, and any extra details you want to record. Pick it when you add an investment and the answers are already filled in.',
    mock: null,
    steps: [
      { title: 'Open My categories', text: 'Go to Settings and choose My categories, or choose Create your own at the end of the category list when you add an investment.' },
      { title: 'Start from something close', text: 'Choose Start from to copy an existing category, or begin from scratch. Then give it a name and an icon.' },
      { title: 'Choose the starting answers', text: 'Pick how its value changes, what income it pays and who usually owns it. These are only starting answers. You can change every one when you add an investment.', more: 'valuations-rates' },
      { title: 'Add the details you want', text: 'Add questions such as plot size or registration number, and choose whether each is text, a number, a date or a link. You can add up to 15.' },
      { title: 'Change it or delete it later', text: 'Changes to the starting answers apply to investments you add from then on. Existing investments keep their own settings. A category that investments use cannot be deleted. An unused one can be, and you can undo it or restore it from Recently deleted.' },
    ],
    tryIt: { label: 'Open My categories', route: '#/categories' },
    goodToKnow: 'Removing a detail from a category stops asking for it on new investments. A value you already saved stays saved and still shows on that investment.',
    glossary: [], faq: [],
    sample: null,
    keywords: 'category categories custom own create kind type template icon details fields land vehicle new',
  },
]);

// ---------- glossary ----------
export const GLOSSARY = Object.freeze([
  { id: 'agreed-rate', term: 'Agreed rate', meaning: 'A rate fixed by a contract or an offer, such as the interest on a treasury bill or on a loan you gave. Use it when someone has promised you the figure.' },
  { id: 'annualized', term: 'Annualized return', meaning: 'The yearly rate your investment has effectively earned, so a 3-year plot and a 6-month fixed deposit can be compared fairly. Apex works it out as CAGR or XIRR. When an investment has been held for under a year, treat it as a rough guide.' },
  { id: 'assumed-rate', term: 'Assumed rate', meaning: 'Your own estimate of yearly growth or loss, for example 15% a year for land in an area you know. It is a guess you can change, not a promise. Apex uses it only when there is no valuation.' },
  { id: 'cagr', term: 'CAGR', aka: 'compound annual growth rate', meaning: 'The yearly rate that turns what you put in into what it is worth now. Apex uses it when you put in one lump sum and nothing else happened. For example, ₦10,000,000 becoming ₦14,400,000 over 2 years is 20% a year.' },
  { id: 'closed', term: 'Closed', meaning: 'An investment you have sold, cashed out or finished. Its worth becomes the proceeds you recorded, and the clock stops on the closing date. You can reopen it.' },
  { id: 'income-yield', term: 'Income yield', meaning: 'Income and payouts of the last 12 months, minus costs, divided by the total money put in. It shows how hard an asset works in cash, apart from any growth in value.' },
  { id: 'invested', term: 'Invested', aka: 'money put in', meaning: 'All the money you have paid into an investment: the purchase price and any top-ups. Costs are counted separately.' },
  { id: 'kobo', term: 'Kobo rounding', aka: 'kobo', meaning: 'A kobo is one hundredth of a naira. Apex counts in whole kobo and rounds only once, at the very end of each figure, to the nearest kobo with halves going up. That keeps totals adding up exactly, with no tiny errors piling up.' },
  { id: 'ledger', term: 'Ledger', meaning: 'The dated list of every payment into or out of an investment, newest first.' },
  { id: 'net-gain', term: 'Net gain', meaning: 'What you are ahead, or behind, after everything: worth plus income received, minus the money put in and the costs.' },
  { id: 'ownership-share', term: 'Share', aka: 'ownership share, percentage', meaning: 'Your percentage of a shared investment. Shares must total exactly 100%, and Apex splits every amount to the exact kobo.' },
  { id: 'payout', term: 'Payout', aka: 'share-out', meaning: 'Money a business or partnership shares out to you, such as a December share-out. It counts as income.' },
  { id: 'proceeds', term: 'Proceeds', aka: 'sale proceeds', meaning: 'The money you receive when you sell or cash out an investment. You enter it when you close the investment.' },
  { id: 'projection', term: 'Projection', aka: 'forecast, what if', meaning: 'A what-if, not a fact. Apex takes what an investment is worth today, applies a yearly rate you choose and shows where that would lead. It is never saved and never changes your real figures. For example, ₦10,000,000 at 12% a year, simple, is ₦11,200,000 after one year.' },
  { id: 'recovery-key', term: 'Recovery key', meaning: 'The long key shown once when you created your account. It is the way back in if you forget your password and cannot unlock on this device. Apex keeps no copy, so nobody can recreate it for you.' },
  { id: 'regular-payment', term: 'Regular payment', aka: 'schedule, recurring', meaning: 'A repeating income or cost, such as rent every year or a monthly service charge. Apex works out when each one is due and lists it under Coming up. It counts in your figures only after you record it in the ledger.' },
  { id: 'roi', term: 'Return on investment', aka: 'ROI', meaning: 'Net gain divided by the money put in plus costs, shown as a percentage. It ignores time, so 30% over one year and 30% over ten years look the same. Annualized return fixes that.' },
  { id: 'simple-compound', term: 'Simple and compound', aka: 'interest', meaning: 'Simple growth adds the same amount each year, based on what you first put in. Compound growth lets earlier gains earn too. Over 3 years (1,095 days) at 10% a year, ₦1,000,000 becomes ₦1,300,000 simple or ₦1,331,000 compounded.' },
  { id: 'thrift', term: 'Thrift', aka: 'ajo, esusu, cooperative', meaning: 'A savings group where members pay in regularly and take turns to collect the pot. In Apex, use the Cooperative / thrift category.' },
  { id: 'valuation', term: 'Valuation', meaning: 'Your record of what an asset is worth on a given date, from an agent, a bank, a comparable sale or your own estimate. The latest one is used exactly as you entered it.' },
  { id: 'worth', term: 'Worth today', aka: 'current value', meaning: 'The value Apex shows for an investment. It is your latest valuation, or else the money put in grown at your rate, or else what you paid. For a closed investment it is what you sold for.' },
  { id: 'xirr', term: 'XIRR', aka: 'extended internal rate of return', meaning: 'The yearly rate that balances every dated payment in and out, including a later valuation. Apex uses it when money moved on several dates. Sometimes no sensible answer exists, and Apex then says Not available yet instead of showing a wrong number.' },
]);

// ---------- frequently asked questions ----------
export const FAQ = Object.freeze([
  { id: 'documents-offline', find: 'document file upload offline internet open download attach', q: 'Can I add or open a document without internet?', topic: 'documents',
    a: 'No. The records in Apex work offline, but a document is a locked file stored on the server, so adding or opening one needs a connection. Try again when you are online. Nothing is lost if an upload fails.' },
  { id: 'loan-repay', find: 'loan given repayment repaid paid back owed balance interest', q: 'How do I record money a borrower paid back?', topic: 'income-costs',
    a: 'Open the loan, choose Add entry, and pick A loan repayment. Apex takes it off what you are still owed and keeps counting interest only on the rest, so the repayment is never counted twice. Your gain is the interest you have earned. If you would rather type the balance yourself, add a valuation with what is still owed; repayments then still count as money you received.' },
  { id: 'edit-saved', find: 'edit change wrong mistake name rate date saved investment fix', q: 'Can I fix something I already saved?', topic: 'income-costs',
    a: 'Yes. Open the investment and choose Edit to change its name, dates, rates and details. Tap any ledger entry or valuation to change or delete it. Every change is kept: open Change history on the Details tab to see earlier versions and restore one. Anything you delete stays in Settings under Recently deleted until you bring it back.' },
  { id: 'rent-missing', find: 'rent income received not showing missing upcoming recorded', q: 'Why does my rent not show as received?', topic: 'income-costs',
    a: 'A regular payment only tells Apex when money is expected. It appears under Coming up on Home until you record it. Open the investment, choose Add entry, pick Income received, and enter the date and amount when the rent actually reaches you. When you set up a new investment you can also tick the box that records payments already due as received.' },
  { id: 'lose-key', find: 'lost forgot recovery key password locked out', q: 'What if I lose my recovery key?', topic: 'privacy',
    a: 'Apex keeps no copy, so nobody can recreate it, including the person who built the app. If you can still unlock Apex on this device with your PIN or password, go to Settings and choose Create a new recovery key, then save the new one at once. If you cannot unlock Apex and the key is gone, the records cannot be recovered.' },
  { id: 'annualized-missing', find: 'annualized return not available n/a cagr xirr missing', q: 'Why is my annualized return not available?', topic: 'numbers',
    a: 'Apex shows Not available yet when it cannot give an honest number. This happens when the investment started today so no days have passed, when no money put in has been recorded, or when money has only moved one way, for example money in and a worth recorded as nothing. Add the missing entry or a valuation and it appears.' },
  { id: 'at-cost', find: 'worth cost paid same no valuation', q: 'Why does the worth equal what I paid?', topic: 'valuations-rates',
    a: 'When there is no valuation and no rate, Apex shows the investment at cost and says so under the figure. Add a valuation, or set an assumed rate on the investment, and the worth will change.' },
  { id: 'valuation-ignores-rate', find: 'valuation rate stopped growth worth stuck', q: 'I set a rate, so why did the worth stop following it?', topic: 'valuations-rates',
    a: 'A valuation always beats a rate, and Apex does not stretch it forward. After you add a valuation, the worth stays at that figure until you add a newer one. If you want the rate to apply again, add a fresh valuation on the date you trust.' },
  { id: 'thrift', find: 'ajo esusu thrift cooperative contribution', q: 'How do I record a thrift (ajo) or cooperative?', topic: 'income-costs',
    a: 'Add it under Cooperative / thrift. Record every contribution as money put in, with its date. When you collect the pot, close the investment and enter the amount you received as the proceeds. Apex then compares what you paid in with what you collected.' },
  { id: 'pin-removed', find: 'pin wrong tries removed unlock', q: 'Why did my PIN stop working?', topic: 'privacy',
    a: 'After 5 wrong tries Apex removes the PIN from the device to protect your records. Sign in with your email and password, then choose Set or change PIN in Settings to create a new one.' },
  { id: 'other-device', find: 'sync another phone laptop device backup', q: 'Can I open my records on another phone or laptop?', topic: 'privacy',
    a: 'Yes. Sign in with your email and password on the other device and your records appear there, usually within a few seconds. Apex keeps an encrypted copy online that only your password or recovery key can open. If a device is offline, changes wait on it and are backed up when it reconnects.' },
  { id: 'deleted-by-mistake', find: 'deleted undo restore bring back recover delete', q: 'I deleted something by mistake. Can I get it back?', topic: 'closing',
    a: 'Yes, but only for a few seconds. After a delete, a message appears with Undo for about nine seconds. Tap it and everything comes back. Once it has gone, the app cannot restore it. If you only wanted to mark an investment as finished, close it instead.' },
]);

// ---------- lookups and checks that need no screen ----------
export const topicById = (id) => TOPICS.find((t) => t.id === id) || null;
export const termById = (id) => GLOSSARY.find((g) => g.id === id) || null;
export const faqById = (id) => FAQ.find((f) => f.id === id) || null;
export const HELP_ROUTE = Object.freeze({ home: '#/help', glossary: '#/help/glossary', faq: '#/help/faq', topic: (id) => `#/help/${id}`, term: (id) => `#/help/glossary/${id}`, question: (id) => `#/help/faq/${id}` });

// Turns a topic's tryIt into something the screen can draw. investments: [{ id, name, status, sample }].
// Needs an investment? Picks the first active real one, then a sample one, and falls back to "add one first".
export function resolveTry(tryIt, investments = []) {
  if (!tryIt) return null;
  if (tryIt.route) return { kind: 'link', href: tryIt.route, label: tryIt.label };
  if (tryIt.action) return { kind: 'action', action: tryIt.action, label: tryIt.label };
  const pool = tryIt.record ? investments.filter((i) => i.status !== 'closed') : investments;
  const pick = pool.find((i) => !i.sample) || pool[0];
  if (!pick) return { kind: 'link', href: '#/new', label: tryIt.fallbackLabel || 'Add an investment first', note: tryIt.fallbackNote || 'You need an investment for this. Add one, or try the sample portfolio.' };
  const href = tryIt.record ? `#/investments/${pick.id}/${tryIt.record}` : `#/investments/${pick.id}`;
  return { kind: 'link', href, label: tryIt.label, note: `Opens ${pick.name ? `“${pick.name}”` : 'your investment'}${pick.sample ? ', which is part of the sample portfolio' : ''}.` };
}

// Where a sample investment lives, given the ids kept when the sample was added ({ investments: [...] }).
export function sampleHref(key, sampleIds) {
  const at = SAMPLE_INVESTMENTS[key]?.index;
  const id = at == null ? null : sampleIds?.investments?.[at];
  return id ? `#/investments/${id}` : null;
}

// Search entries for the command palette (Ctrl K). They show up only once the person types.
export function helpSearchItems() {
  const items = [];
  for (const t of TOPICS) items.push({ group: 'Help', label: t.title, sub: 'Help topic', icon: t.icon, keywords: t.keywords, hash: HELP_ROUTE.topic(t.id), searchOnly: true });
  // Only short, curated words are searched (never whole paragraphs), so a search such as "rent" does not match "current".
  for (const g of GLOSSARY) items.push({ group: 'Help', label: g.term, sub: 'Glossary', icon: 'book', keywords: g.aka || '', hash: HELP_ROUTE.term(g.id), searchOnly: true });
  for (const f of FAQ) items.push({ group: 'Help', label: f.q, sub: 'Question', icon: 'help', keywords: f.find || '', hash: HELP_ROUTE.question(f.id), searchOnly: true });
  return items;
}

// Everything that must be true for the Help to be trustworthy. Returns a list of plain-language problems (empty = fine).
export function checkHelpContent() {
  const problems = [], seen = new Set();
  const unique = (kind, id) => { const k = `${kind}:${id}`; if (seen.has(k)) problems.push(`Duplicate ${kind} id "${id}"`); seen.add(k); };
  for (const t of TOPICS) {
    unique('topic', t.id);
    for (const key of ['title', 'icon', 'summary', 'lead', 'goodToKnow']) if (!t[key]) problems.push(`Topic "${t.id}" has no ${key}`);
    if (!t.steps?.length) problems.push(`Topic "${t.id}" has no steps`);
    for (const s of t.steps || []) {
      if (!s.title || !s.text) problems.push(`Topic "${t.id}" has an empty step`);
      if (s.more && !topicById(s.more)) problems.push(`Topic "${t.id}" step "${s.title}" links to missing topic "${s.more}"`);
    }
    const ty = t.tryIt;
    if (!ty || !ty.label) problems.push(`Topic "${t.id}" has no Try it now button`);
    else if (ty.route && !STATIC_ROUTES.includes(ty.route)) problems.push(`Topic "${t.id}" Try it points at unknown route ${ty.route}`);
    else if (ty.record && !RECORD_KINDS.includes(ty.record)) problems.push(`Topic "${t.id}" Try it points at unknown record form "${ty.record}"`);
    else if (ty.action && !TRY_ACTIONS.includes(ty.action)) problems.push(`Topic "${t.id}" Try it uses unknown action "${ty.action}"`);
    else if (!ty.route && !ty.record && !ty.action && !ty.detail) problems.push(`Topic "${t.id}" Try it has no target`);
    for (const g of t.glossary || []) if (!termById(g)) problems.push(`Topic "${t.id}" uses missing glossary term "${g}"`);
    for (const f of t.faq || []) if (!faqById(f)) problems.push(`Topic "${t.id}" uses missing question "${f}"`);
    if (t.sample && !SAMPLE_INVESTMENTS[t.sample.key]) problems.push(`Topic "${t.id}" points at missing sample investment "${t.sample.key}"`);
  }
  for (const g of GLOSSARY) { unique('term', g.id); if (!g.term || !g.meaning) problems.push(`Glossary term "${g.id}" is empty`); }
  for (const f of FAQ) { unique('faq', f.id); if (!f.q || !f.a) problems.push(`Question "${f.id}" is empty`); if (!topicById(f.topic)) problems.push(`Question "${f.id}" links to missing topic "${f.topic}"`); }
  if (!topicById(HELP_HOME.startId)) problems.push('The Start here topic is missing');
  return problems;
}
