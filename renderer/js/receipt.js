// The printed A4 invoice (the blue design). Builds plain HTML that is printed or saved as PDF.

const Receipt = {
  darken(hex, f = 0.45) {
    const n = parseInt(hex.replace('#', ''), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  },

  css(s) {
    const B = s.color || '#14a9e8';
    const D = Receipt.darken(B);
    return `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #1a2430; background: #fff; }
.page { width: 210mm; height: 297mm; padding: 16mm 16mm 12mm; position: relative; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
header { display: flex; justify-content: space-between; border-bottom: 3px solid ${B}; padding-bottom: 10px; }
h1 { margin: 0; font-size: 22pt; letter-spacing: 1px; color: ${D}; }
.tag { font-size: 8.5pt; font-weight: 700; color: ${B}; margin: 2px 0 6px; text-transform: uppercase; letter-spacing: .4px; }
.addr { font-size: 9pt; line-height: 1.5; color: #3e4a56; }
.doc { text-align: right; }
.badge { display: inline-block; border: 1.5px solid ${B}; color: ${B}; font-size: 8pt; font-weight: 700; padding: 2px 8px; border-radius: 3px; letter-spacing: 1px; }
.badge.copy { border-color: #8996a2; color: #5d6b78; }
.dt { font-size: 15pt; font-weight: 700; margin: 6px 0 6px; letter-spacing: 1px; }
.keys { display: flex; gap: 8px; justify-content: flex-end; }
.key { border: 2px solid ${B}; border-radius: 5px; padding: 4px 12px; text-align: center; min-width: 34mm; }
.key span { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .8px; color: #5d6b78; font-weight: 700; }
.key b { font-size: 17pt; color: ${D}; letter-spacing: .5px; }
.kind { font-size: 9pt; color: #5d6b78; margin-top: 5px; }
.parties { display: flex; gap: 12px; margin: 14px 0; }
.box { flex: 1; border: 1px solid #bcd9ea; border-radius: 4px; padding: 8px 10px; line-height: 1.55; font-size: 9.5pt; }
.box:first-child { flex: 1.6; }
.lbl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .8px; color: #5d6b78; font-weight: 700; margin-bottom: 3px; }
.cn { font-weight: 700; font-size: 11pt; }
.dorm { font-size: 11pt; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { background: ${B}; color: #fff; font-weight: 600; padding: 6px 7px; text-align: left; font-size: 8.5pt; }
td { padding: 5px 7px; border-bottom: 1px solid #dbe9f1; }
tbody tr:nth-child(even) { background: #eef7fc; }
.n { width: 24px; color: #5d6b78; }
.c { text-align: center !important; }
.r { text-align: right !important; }
.sum { display: flex; justify-content: flex-end; margin-top: 10px; }
.tot { width: 42%; border-collapse: collapse; font-size: 10pt; }
.tot td { padding: 5px 8px; border-bottom: 1px solid #dbe9f1; background: none !important; }
.tot .due td { background: ${D} !important; color: #fff; font-weight: 700; font-size: 11pt; border: none; }
.note { margin-top: 12px; font-size: 8.5pt; font-weight: 600; color: #3e4a56; }
.sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 40px; margin-top: 40px; }
.s { font-size: 9pt; font-weight: 600; color: #3e4a56; }
.s i { display: block; border-bottom: 1px solid #1a2430; height: 28px; margin-bottom: 4px; }
.ack { margin-top: 14px; font-size: 8.5pt; text-align: center; font-style: italic; color: #3e4a56; }
footer { position: absolute; bottom: 10mm; left: 16mm; right: 16mm; text-align: center; font-size: 8pt; color: #8996a2; border-top: 1px solid #dbe9f1; padding-top: 5px; }
`;
  },

  // inv: invoice from getWeek(); week: week row; products: list; label: 'ORIGINAL' | 'COPY'
  page(s, week, inv, products, label) {
    const e = U.esc;
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = inv.lines
      .map((l) => ({ ...l, p: byId.get(l.product_id) || { code: '?', name: '?', unit: '', sort: 0 } }))
      .sort((a, b) => (a.p.sort - b.p.sort) || a.p.name.localeCompare(b.p.name));
    const rows = lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td>${e(l.p.code)}</td><td>${e(l.p.name)}</td>
      <td class="c">${U.qty(l.qty)}</td><td class="c">${e(l.p.unit)}</td><td class="r">${U.money(l.unit_price)}</td>
      <td class="r">${U.money(Math.round(l.qty * l.unit_price * 100) / 100)}</td></tr>`).join('');
    const kind = inv.series === 'DF' ? 'Vegetables' : 'Potatoes &amp; Onions';
    const sig = s.signature_labels || [];
    return `<section class="page">
<header>
  <div><h1>${e(s.company_name)}</h1><div class="tag">${e(s.company_tagline)}</div>
    <div class="addr">${e(s.company_address)}<br>Tel: ${e(s.company_phone)} &nbsp;·&nbsp; BRN: ${e(s.company_brn)}<br>
    ${e(s.company_emails).split(',').map((x) => x.trim()).join(' &nbsp;·&nbsp; ')}</div></div>
  <div class="doc"><span class="badge ${label === 'COPY' ? 'copy' : ''}">${e(label)}</span><div class="dt">SALES INVOICE</div>
    <div class="keys"><div class="key"><span>Invoice No</span><b>${inv.series}-${inv.number}</b></div>
    <div class="key"><span>Date</span><b>${U.date(week.date)}</b></div></div><div class="kind">${kind}</div></div>
</header>
<div class="parties">
  <div class="box"><div class="lbl">Bill To / Deliver To</div><div class="cn">${e(s.customer_name)}</div>
    Dormitory – ${e(inv.dorm_name)}<br><b class="dorm">Dorm No ${inv.dorm_no}</b></div>
  <div class="box"><div class="lbl">Delivery</div>Vehicle No: <b>${e(inv.vehicle)}</b><br>Delivery Date: <b>${U.date(week.date)}</b></div>
</div>
<table><thead><tr><th class="n">#</th><th>Item Code</th><th>Description</th><th class="c">Qty</th><th class="c">UOM</th>
  <th class="r">Unit Price (Rs)</th><th class="r">Amount (Rs)</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sum"><table class="tot">
  <tr><td>Total</td><td class="r">${U.money(inv.total)}</td></tr>
  ${s.show_part_payment ? `<tr><td>Part Payment</td><td class="r">${U.money(inv.part_payment)}</td></tr>` : ''}
  <tr class="due"><td>Balance Due (Rs)</td><td class="r">${U.money(inv.balance)}</td></tr></table></div>
<div class="note">${e(s.note)}</div>
<div class="sigs">${sig.map((t) => `<div class="s"><i></i>${e(t)}</div>`).join('')}</div>
<div class="ack">${e(s.acknowledgment)}</div>
${s.show_footer && s.footer_text ? `<footer>${e(s.footer_text)}</footer>` : ''}
</section>`;
  },

  doc(s, pagesHtml, title = 'Invoices') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${U.esc(title)}</title><style>${Receipt.css(s)}</style></head><body>${pagesHtml}</body></html>`;
  },

  // labels: ['ORIGINAL'] / ['COPY'] / ['ORIGINAL','COPY']
  build(s, week, invoices, products, labels) {
    const pages = invoices.map((inv) => labels.map((l) => Receipt.page(s, week, inv, products, l)).join('')).join('');
    return Receipt.doc(s, pages);
  },
};
