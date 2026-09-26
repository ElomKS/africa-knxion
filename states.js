// US states (including DC) used across Africa KNXION for filtering and forms.
export const US_STATES = [
  { name: 'Alabama', code: 'AL' },
  { name: 'Alaska', code: 'AK' },
  { name: 'Arizona', code: 'AZ' },
  { name: 'Arkansas', code: 'AR' },
  { name: 'California', code: 'CA' },
  { name: 'Colorado', code: 'CO' },
  { name: 'Connecticut', code: 'CT' },
  { name: 'Delaware', code: 'DE' },
  { name: 'District of Columbia', code: 'DC' },
  { name: 'Florida', code: 'FL' },
  { name: 'Georgia', code: 'GA' },
  { name: 'Hawaii', code: 'HI' },
  { name: 'Idaho', code: 'ID' },
  { name: 'Illinois', code: 'IL' },
  { name: 'Indiana', code: 'IN' },
  { name: 'Iowa', code: 'IA' },
  { name: 'Kansas', code: 'KS' },
  { name: 'Kentucky', code: 'KY' },
  { name: 'Louisiana', code: 'LA' },
  { name: 'Maine', code: 'ME' },
  { name: 'Maryland', code: 'MD' },
  { name: 'Massachusetts', code: 'MA' },
  { name: 'Michigan', code: 'MI' },
  { name: 'Minnesota', code: 'MN' },
  { name: 'Mississippi', code: 'MS' },
  { name: 'Missouri', code: 'MO' },
  { name: 'Montana', code: 'MT' },
  { name: 'Nebraska', code: 'NE' },
  { name: 'Nevada', code: 'NV' },
  { name: 'New Hampshire', code: 'NH' },
  { name: 'New Jersey', code: 'NJ' },
  { name: 'New Mexico', code: 'NM' },
  { name: 'New York', code: 'NY' },
  { name: 'North Carolina', code: 'NC' },
  { name: 'North Dakota', code: 'ND' },
  { name: 'Ohio', code: 'OH' },
  { name: 'Oklahoma', code: 'OK' },
  { name: 'Oregon', code: 'OR' },
  { name: 'Pennsylvania', code: 'PA' },
  { name: 'Rhode Island', code: 'RI' },
  { name: 'South Carolina', code: 'SC' },
  { name: 'South Dakota', code: 'SD' },
  { name: 'Tennessee', code: 'TN' },
  { name: 'Texas', code: 'TX' },
  { name: 'Utah', code: 'UT' },
  { name: 'Vermont', code: 'VT' },
  { name: 'Virginia', code: 'VA' },
  { name: 'Washington', code: 'WA' },
  { name: 'West Virginia', code: 'WV' },
  { name: 'Wisconsin', code: 'WI' },
  { name: 'Wyoming', code: 'WY' },
];

// Look up a state name by its stored code or name.
export function stateLabel(value) {
  if (!value) return '';
  const v = String(value).trim();
  if (!v) return '';
  const found = US_STATES.find(
    (s) => s.code === v.toUpperCase() || s.name.toLowerCase() === v.toLowerCase()
  );
  return found ? `${found.name} (${found.code})` : v;
}

// Normalize a raw state input into a 2-letter code (or '' if invalid).
export function normalizeState(value) {
  if (!value) return '';
  const v = String(value).trim().toUpperCase();
  if (!v) return '';
  const found = US_STATES.find((s) => s.code === v || s.name.toUpperCase() === v);
  return found ? found.code : v;
}

// Build a compact "City, ST" or "City, ST ZIP" string from address parts.
export function cityState(value, { state = '', zip = '' } = {}) {
  const city = String(value || '').trim();
  const st = String(state || '').trim().toUpperCase();
  const zp = String(zip || '').trim();
  const parts = [];
  if (city) parts.push(city);
  if (st) parts.push(st);
  if (zp) parts.push(zp);
  return city && st ? parts.join(', ') : parts.join(' ');
}

// Full human-friendly address line: "City, State (ST) ZIP".
export function formatLocation(entry = {}) {
  const city = String(entry.city || '').trim();
  const state = String(entry.state || '').trim();
  const zip = String(entry.zip || '').trim();
  const label = stateLabel(state);
  const bits = [];
  if (city) bits.push(city);
  if (label) bits.push(label);
  if (zip) bits.push(zip);
  return bits.join(', ') || null;
}