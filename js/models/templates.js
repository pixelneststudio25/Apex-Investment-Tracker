// Built-in category templates (General System Plan section 6). A template is only a label plus presets:
// the real behaviour of an investment lives in its `behaviors` and `rates`, so users can change anything.
// Built-ins live in code; custom categories the user creates are stored as `categoryTemplate` records.
const B = (valueChange, income = 'none', ownership = 'sole', term = null) => ({ valueChange, income, ownership, term });
const F = (key, label, type = 'text') => ({ key, label, type });

export const BUILT_IN_TEMPLATES = Object.freeze([
  { id: 'land', name: 'Land', icon: 'land', defaultBehaviors: B('appreciation'),
    customFieldDefs: [F('location', 'Location'), F('plotSize', 'Plot size'), F('titleDocument', 'Title document / C of O number'), F('surveyPlanNo', 'Survey plan number'), F('seller', 'Bought from')] },
  { id: 'property-rental', name: 'Property (rental)', icon: 'house', defaultBehaviors: B('appreciation', 'schedule'),
    customFieldDefs: [F('address', 'Address'), F('propertyType', 'Property type'), F('bedrooms', 'Bedrooms', 'number'), F('tenant', 'Tenant'), F('titleDocument', 'Title document number')] },
  { id: 'property-development', name: 'Property (development)', icon: 'building', defaultBehaviors: B('manualOnly'),
    customFieldDefs: [F('address', 'Address'), F('developer', 'Developer'), F('completionDate', 'Expected completion', 'date'), F('unitNumber', 'Unit number')] },
  { id: 'vehicle', name: 'Vehicle', icon: 'car', defaultBehaviors: B('depreciation', 'schedule'),
    customFieldDefs: [F('make', 'Make'), F('model', 'Model'), F('year', 'Year', 'number'), F('plateNumber', 'Plate number'), F('chassisNumber', 'Chassis number'), F('driverOrRenter', 'Driver / renter')] },
  { id: 'business-stake', name: 'Business stake', icon: 'handshake', defaultBehaviors: B('manualOnly', 'irregular'),
    customFieldDefs: [F('companyName', 'Company'), F('rcNumber', 'RC number'), F('shareClass', 'Share class'), F('sharesHeld', 'Shares held', 'number')] },
  { id: 'partnership', name: 'Partnership', icon: 'users', defaultBehaviors: B('manualOnly', 'irregular', 'shared'),
    customFieldDefs: [F('venture', 'Venture'), F('agreementDate', 'Agreement date', 'date'), F('leadPartner', 'Lead partner')] },
  { id: 'fixed-income', name: 'Fixed deposit / treasury bill', icon: 'landmark', defaultBehaviors: B('interest', 'none', 'sole', { maturityDate: '2100-01-01' }),
    customFieldDefs: [F('institution', 'Institution'), F('instrumentType', 'Instrument'), F('referenceNumber', 'Reference number')] },
  { id: 'loan-given', name: 'Loan given', icon: 'coins', defaultBehaviors: B('interest', 'irregular'),
    customFieldDefs: [F('borrower', 'Borrower'), F('agreementDate', 'Agreement date', 'date'), F('security', 'Security held')] },
  { id: 'farm-livestock', name: 'Farm / livestock', icon: 'sprout', defaultBehaviors: B('manualOnly', 'irregular'),
    customFieldDefs: [F('location', 'Location'), F('produce', 'Crop / livestock'), F('manager', 'Farm manager')] },
  { id: 'equipment', name: 'Equipment', icon: 'wrench', defaultBehaviors: B('depreciation', 'schedule'),
    customFieldDefs: [F('make', 'Make'), F('model', 'Model'), F('serialNumber', 'Serial number'), F('operator', 'Operator / renter')] },
  { id: 'precious-metals', name: 'Precious metals', icon: 'gem', defaultBehaviors: B('manualOnly'),
    customFieldDefs: [F('metal', 'Metal'), F('weight', 'Weight'), F('storedAt', 'Stored at')] },
  { id: 'crypto', name: 'Crypto', icon: 'bitcoin', defaultBehaviors: B('manualOnly'),
    customFieldDefs: [F('asset', 'Asset'), F('quantity', 'Quantity', 'number'), F('platform', 'Platform / wallet')] },
  { id: 'stocks', name: 'Stocks', icon: 'chart', defaultBehaviors: B('manualOnly', 'irregular'),
    customFieldDefs: [F('company', 'Company'), F('ticker', 'Ticker'), F('units', 'Units', 'number'), F('broker', 'Broker')] },
  { id: 'collectibles', name: 'Collectibles', icon: 'frame', defaultBehaviors: B('manualOnly'),
    customFieldDefs: [F('item', 'Item'), F('maker', 'Maker / artist'), F('provenance', 'Provenance')] },
  { id: 'cooperative-thrift', name: 'Cooperative / thrift', icon: 'piggy', defaultBehaviors: B('none', 'irregular'),
    customFieldDefs: [F('groupName', 'Group'), F('memberNumber', 'Member number'), F('cycleLength', 'Cycle length')] },
  { id: 'other', name: 'Other', icon: 'tag', defaultBehaviors: B('manualOnly', 'irregular'), customFieldDefs: [] },
].map((t) => Object.freeze(t)));

// Looks a category up by id: built-ins first, then the user's own templates (records from the store).
export function findTemplate(id, customTemplates = []) {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id) || customTemplates.find((t) => t.id === id) || null;
}
