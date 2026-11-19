// How receipts and statements look (Settings → Receipt format / Statement format).
// Saved in the settings table as JSON under "receipt_format" and "statement_format".
// The defaults are exactly the original Modern blue design, so nothing changes until the user edits it.

const COLUMN_KEYS = ['no', 'code', 'desc', 'qty', 'uom', 'price', 'amount'];
const ALWAYS_ON = ['desc', 'amount'];
const SHOW_KEYS = ['badge', 'emails', 'brn', 'delivery', 'vehicle', 'part_payment', 'amount_words',
  'signatures', 'acknowledgment', 'footer', 'watermark'];

const DEFAULT_RECEIPT = {
  template: 'modern',            // modern | classic | simple
  color: '#14a9e8',
  logo: '',                      // data URL (PNG/JPG) or ''
  text_size: 'normal',           // small | normal | large
  show: {
    badge: true, emails: true, brn: true, delivery: true, vehicle: true, part_payment: true,
    amount_words: false, signatures: true, acknowledgment: true, footer: true, watermark: false,
  },
  columns: COLUMN_KEYS.map((key) => ({ key, on: true })),   // order = order on the receipt
  title: 'Sales Invoice',
  note: 'Note: Goods once sold and delivered are not refundable.',
  acknowledgment: 'Acknowledgment: all goods are received in good condition.',
  footer: 'Payment due monthly · Thank you for your business',
  signatures: ['Driver Signature', 'Received By Cook', 'Signature', 'Signature'],
  paper: 'A4',                   // A4 | A5 | Letter
  margins: 'normal',             // narrow | normal | wide
  copies: 'original_copy',       // original | original_copy
  empty_rows: 'none',            // none | fill15
};

const DEFAULT_STATEMENT = {
  color: '#14a9e8',
  logo: false,                   // show the receipt logo on the statement
  title: 'Monthly Statement',
  footer: '',
  show_summary: true,            // page 2: summary by dormitory
  show_payment: true,            // amount due / payment received boxes
};

// The settings keys used before receipt_format existed.
const OLD_KEYS = ['color', 'note', 'acknowledgment', 'signature_labels', 'footer_text', 'show_footer', 'show_part_payment', 'print_copy'];

const MAX_LOGO = 1400000;   // characters of data URL (a 1 MB picture)
const clone = (x) => JSON.parse(JSON.stringify(x));
const pick = (v, list, def) => (list.includes(v) ? v : def);
const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const text = (v, def, max = 400) => (typeof v === 'string' ? v.slice(0, max) : def);

// Fill in anything missing and drop anything wrong. strict: throw (with a message for the user)
// instead of quietly dropping a bad logo; used when saving.
function normalizeReceipt(f, strict = false, fail = (m) => { throw new Error(m); }) {
  const d = DEFAULT_RECEIPT;
  f = f && typeof f === 'object' ? f : {};
  const out = clone(d);
  out.template = pick(f.template, ['modern', 'classic', 'simple'], d.template);
  out.color = isColor(f.color) ? f.color.toLowerCase() : d.color;
  if (typeof f.logo === 'string' && f.logo) {
    const ok = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(f.logo) && f.logo.length <= MAX_LOGO;
    if (ok) out.logo = f.logo;
    else if (strict) fail('The logo must be a PNG or JPG picture of 1 MB or less.');
  }
  out.text_size = pick(f.text_size, ['small', 'normal', 'large'], d.text_size);
  const show = f.show && typeof f.show === 'object' ? f.show : {};
  for (const k of SHOW_KEYS) out.show[k] = typeof show[k] === 'boolean' ? show[k] : d.show[k];
  const cols = [];
  for (const c of Array.isArray(f.columns) ? f.columns : []) {
    if (c && COLUMN_KEYS.includes(c.key) && !cols.some((x) => x.key === c.key)) cols.push({ key: c.key, on: c.on !== false });
  }
  for (const key of COLUMN_KEYS) if (!cols.some((x) => x.key === key)) cols.push({ key, on: true });
  for (const c of cols) if (ALWAYS_ON.includes(c.key)) c.on = true;
  out.columns = cols;
  out.title = text(f.title, d.title, 60);
  out.note = text(f.note, d.note);
  out.acknowledgment = text(f.acknowledgment, d.acknowledgment);
  out.footer = text(f.footer, d.footer);
  if (Array.isArray(f.signatures)) {
    if (strict && f.signatures.length > 6) fail('There can be at most 6 signature lines.');
    out.signatures = f.signatures.slice(0, 6).map((s) => String(s ?? '').slice(0, 60));
  }
  out.paper = pick(f.paper, ['A4', 'A5', 'Letter'], d.paper);
  out.margins = pick(f.margins, ['narrow', 'normal', 'wide'], d.margins);
  out.copies = pick(f.copies, ['original', 'original_copy'], d.copies);
  out.empty_rows = pick(f.empty_rows, ['none', 'fill15'], d.empty_rows);
  return out;
}

function normalizeStatement(f) {
  const d = DEFAULT_STATEMENT;
  f = f && typeof f === 'object' ? f : {};
  return {
    color: isColor(f.color) ? f.color.toLowerCase() : d.color,
    logo: typeof f.logo === 'boolean' ? f.logo : d.logo,
    title: text(f.title, d.title, 60),
    footer: text(f.footer, d.footer),
    show_summary: typeof f.show_summary === 'boolean' ? f.show_summary : d.show_summary,
    show_payment: typeof f.show_payment === 'boolean' ? f.show_payment : d.show_payment,
  };
}

// Build the formats from the old settings keys (only the keys that exist are used).
function fromOldKeys(old) {
  const r = clone(DEFAULT_RECEIPT);
  if (isColor(old.color)) r.color = old.color.toLowerCase();
  if (typeof old.note === 'string') r.note = old.note;
  if (typeof old.acknowledgment === 'string') r.acknowledgment = old.acknowledgment;
  if (typeof old.footer_text === 'string') r.footer = old.footer_text;
  if (Array.isArray(old.signature_labels)) r.signatures = old.signature_labels.slice(0, 6).map(String);
  if ('show_footer' in old) r.show.footer = !!old.show_footer;
  if ('show_part_payment' in old) r.show.part_payment = !!old.show_part_payment;
  if ('print_copy' in old) r.copies = old.print_copy ? 'original_copy' : 'original';
  const s = clone(DEFAULT_STATEMENT);
  if (isColor(old.color)) s.color = old.color.toLowerCase();
  return { receipt: normalizeReceipt(r), statement: s };
}

module.exports = {
  DEFAULT_RECEIPT, DEFAULT_STATEMENT, OLD_KEYS, COLUMN_KEYS, SHOW_KEYS,
  normalizeReceipt, normalizeStatement, fromOldKeys,
};
