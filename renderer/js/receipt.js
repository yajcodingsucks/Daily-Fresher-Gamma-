// The printed invoice. Builds plain HTML that is printed or saved as PDF.
// Its look comes from settings.receipt_format (Settings → Receipt format): one of three templates
// (Modern blue, Classic (Excel), Simple B&W), built from shared pieces below.

const Receipt = {
  PAPER: { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] },
  // [top, sides, bottom, footer distance from the bottom] in mm
  MARGINS: { narrow: [10, 10, 8, 6], normal: [16, 16, 12, 10], wide: [22, 22, 16, 12] },
  TEXT: { small: 0.9, normal: 1, large: 1.12 },
  COLUMNS: {
    no: { head: '#', cls: 'n', label: '#' },
    code: { head: 'Item Code', cls: '', label: 'Item Code' },
    desc: { head: 'Description', cls: '', label: 'Description' },
    qty: { head: 'Qty', cls: 'c', label: 'Qty' },
    uom: { head: 'UOM', cls: 'c', label: 'UOM' },
    price: { head: 'Unit Price (Rs)', cls: 'r', label: 'Unit Price' },
    amount: { head: 'Amount (Rs)', cls: 'r', label: 'Amount' },
  },

  fmt(s) { return s.receipt_format; },
  // ['ORIGINAL', 'COPY'] or ['ORIGINAL'], from Paper & printing → Copies
  labels(s) { return Receipt.fmt(s).copies === 'original' ? ['ORIGINAL'] : ['ORIGINAL', 'COPY']; },
  paper(s) { return Receipt.fmt(s).paper; },
  // page size in screen pixels, for previews
  pagePx(f) { const [w, h] = Receipt.PAPER[f.paper]; return [Math.round((w * 96) / 25.4), Math.round((h * 96) / 25.4)]; },

  darken(hex, f = 0.45) {
    const n = parseInt(hex.replace('#', ''), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  },
  lighten(hex, f = 0.9) {
    const n = parseInt(hex.replace('#', ''), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * f));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  },

  // 1234.5 -> "Rupees One Thousand Two Hundred and Thirty-Four and Fifty Cents Only"
  words(amount) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
      'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = (x) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : ''));
    const three = (x) => {
      const h = Math.floor(x / 100); const r = x % 100;
      return [h ? `${ones[h]} Hundred` : '', r ? (h ? 'and ' : '') + two(r) : ''].filter(Boolean).join(' ');
    };
    const allCents = Math.round(Math.abs(Number(amount) || 0) * 100);
    let whole = Math.floor(allCents / 100);
    const cents = allCents % 100;
    const parts = [];
    for (const [size, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']]) {
      const chunk = Math.floor(whole / size);
      if (chunk) { parts.push(three(chunk) + (name ? ` ${name}` : '')); whole -= chunk * size; }
    }
    return `Rupees ${parts.join(' ') || 'Zero'}${cents ? ` and ${two(cents)} Cents` : ''} Only`;
  },

  // ---------- shared pieces ----------

  // Everything a template needs for one invoice page.
  ctx(s, week, inv, products, label) {
    const e = U.esc;
    const f = Receipt.fmt(s);
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = inv.lines
      .map((l) => ({ ...l, p: byId.get(l.product_id) || { code: '?', name: '?', unit: '', sort: 0 } }))
      .sort((a, b) => U.byName(a.p.name, b.p.name));
    const cols = f.columns.filter((c) => c.on).map((c) => ({ key: c.key, ...Receipt.COLUMNS[c.key] }));
    const cell = (key, l, i) => ({
      no: i + 1, code: e(l.p.code), desc: e(l.p.name), qty: U.qty(l.qty), uom: e(l.p.unit),
      price: U.money(l.unit_price), amount: U.money(Math.round(l.qty * l.unit_price * 100) / 100),
    })[key];
    const td = (c, v) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${v}</td>`;
    const rows = lines.map((l, i) => `<tr>${cols.map((c) => td(c, cell(c.key, l, i))).join('')}</tr>`).join('');
    const blanks = f.empty_rows === 'fill15'
      ? Array.from({ length: Math.max(0, 15 - lines.length) }, () => `<tr class="blank">${cols.map((c) => td(c, '&nbsp;')).join('')}</tr>`).join('')
      : '';
    const table = `<table class="items"><thead><tr>${cols.map((c) => `<th${c.cls ? ` class="${c.cls}"` : ''}>${c.head}</th>`).join('')}</tr></thead>
<tbody>${rows}${blanks}</tbody></table>`;
    const sh = f.show;
    const isCopy = label === 'COPY';
    return {
      s, f, e, sh, inv, week, label, isCopy, table,
      no: `${inv.series}-${inv.number}`,
      date: U.date(week.date),
      title: e(f.title.trim() || 'Sales Invoice'),
      kind: inv.series === 'DF' ? 'Vegetables' : 'Potatoes &amp; Onions',
      rev: inv.revised_at ? `<span class="rev">Revised ${U.dayOf(inv.revised_at)}</span>` : '',
      badge: sh.badge ? `<span class="badge ${isCopy ? 'copy' : ''}">${e(label)}</span>` : '',
      logo: f.logo ? `<img class="logo" src="${f.logo}" alt="">` : '',
      emails: e(s.company_emails).split(',').map((x) => x.trim()),
    };
  },

  // Address, then "Tel · BRN", then emails (joined with sep).
  addr(c, sep) {
    const { s, e, sh } = c;
    return [e(s.company_address), `Tel: ${e(s.company_phone)}${sh.brn ? `${sep}BRN: ${e(s.company_brn)}` : ''}`,
      sh.emails ? c.emails.join(sep) : ''].filter(Boolean).join('<br>');
  },

  billTo(c, label = 'Bill To / Deliver To') {
    const { s, e, inv, sh } = c;
    return `<div class="box"><div class="lbl">${label}</div><div class="cn">${e(s.customer_name)}</div>
    Dormitory – ${e(inv.dorm_name)}<br><b class="dorm">Dorm No ${inv.dorm_no}</b>${!sh.delivery && sh.vehicle ? `<br>Vehicle No: <b>${e(inv.vehicle)}</b>` : ''}</div>`;
  },

  delivery(c) {
    const { e, inv, sh } = c;
    if (!sh.delivery) return '';
    return `<div class="box"><div class="lbl">Delivery</div>${sh.vehicle ? `Vehicle No: <b>${e(inv.vehicle)}</b><br>` : ''}Delivery Date: <b>${c.date}</b></div>`;
  },

  totals(c) {
    const { inv, sh } = c;
    return `<table class="tot">
  <tr><td>Total</td><td class="r">${U.money(inv.total)}</td></tr>
  ${sh.part_payment ? `<tr><td>Part Payment</td><td class="r">${U.money(inv.part_payment)}</td></tr>` : ''}
  <tr class="due"><td>Balance Due (Rs)</td><td class="r">${U.money(inv.balance)}</td></tr></table>`;
  },

  amountWords(c) {
    return c.sh.amount_words ? `<div class="words">Amount in words: <b>${Receipt.words(c.inv.total)}</b></div>` : '';
  },

  // A signature line: optional "Name:" above the line, then the label under it.
  // 'cook' prints the dorm's cook name (the one saved when the invoice was printed), 'blank' an empty space to write.
  sigLine(c, l) {
    const { e, inv } = c;
    const name = l.name === 'none' ? ''
      : `<div class="nm">Name: ${l.name === 'cook' && inv.cook_name ? `<b>${e(inv.cook_name)}</b>` : '<span class="blank"></span>'}</div>`;
    return `<div class="s">${name}<i></i>${e(l.label)}</div>`;
  },

  // Note, signatures (+ acknowledgment under them), footer, and the COPY watermark.
  bottom(c) {
    const { f, e, sh } = c;
    const sigs = sh.signatures ? f.signatures : [];
    const sigHtml = sigs.length ? `<div class="sigs pos-${f.sig_position}">${sigs.map((l) => Receipt.sigLine(c, l)).join('')}</div>` : '';
    const ack = sh.acknowledgment && f.acknowledgment ? `<div class="ack">${e(f.acknowledgment)}</div>` : '';
    const pinned = sigs.length && f.sig_position === 'bottom';
    return `${f.note ? `<div class="note">${e(f.note)}</div>` : ''}
${sigHtml || ack ? `<div class="sigblock${pinned ? ' pinned' : ''}">${sigHtml}
${ack}</div>` : ''}
${sh.footer && f.footer ? `<footer>${e(f.footer)}</footer>` : ''}
${sh.watermark && c.isCopy ? '<div class="wm">COPY</div>' : ''}`;
  },

  // Page size, margins and text size, the same for every template.
  baseCss(f, z) {
    const [W, H] = Receipt.PAPER[f.paper];
    const zoom = f.paper === 'A5' ? W / 210 : 1;   // A5 is A4 made smaller, so it looks the same
    const [mt, ms, mb, fb] = Receipt.MARGINS[f.margins];
    const r = (n) => +n.toFixed(2);
    return `
@page { size: ${f.paper === 'Letter' ? 'letter' : f.paper}; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: ${z(10)}; color: #1a2430; background: #fff; }
.page { width: ${W}mm; height: ${H}mm; position: relative; page-break-after: always; overflow: hidden; }
.page:last-of-type { page-break-after: auto; }
.sheet { width: ${r(W / zoom)}mm; height: ${r(H / zoom)}mm; padding: ${mt}mm ${ms}mm ${mb}mm; position: relative; overflow: hidden;${zoom !== 1 ? ` zoom: ${r(zoom * 10000) / 10000};` : ''} }
footer { position: absolute; bottom: ${fb}mm; left: ${ms}mm; right: ${ms}mm; }
.c { text-align: center !important; }
.r { text-align: right !important; }
.wm { position: absolute; left: 0; right: 0; top: 40%; text-align: center; font-size: 140pt; font-weight: 800; letter-spacing: 12px;
  color: rgba(0, 0, 0, .06); transform: rotate(-32deg); pointer-events: none; }
.words { margin-top: 8px; font-size: ${z(9)}; color: #3e4a56; }
.words b { color: #1a2430; }
`;
  },

  // ---------- the three templates ----------
  templates: {
    // The original blue design.
    modern: {
      css(f, z, B, D) {
        return `
header { display: flex; justify-content: space-between; border-bottom: 3px solid ${B}; padding-bottom: 10px; }
.brand { display: flex; gap: 12px; align-items: flex-start; }
.logo { height: 20mm; width: auto; max-width: 45mm; object-fit: contain; }
h1 { margin: 0; font-size: ${z(22)}; letter-spacing: 1px; color: ${D}; }
.tag { font-size: ${z(8.5)}; font-weight: 700; color: ${B}; margin: 2px 0 6px; text-transform: uppercase; letter-spacing: .4px; }
.addr { font-size: ${z(9)}; line-height: 1.5; color: #3e4a56; }
.doc { text-align: right; }
.badge { display: inline-block; border: 1.5px solid ${B}; color: ${B}; font-size: ${z(8)}; font-weight: 700; padding: 2px 8px; border-radius: 3px; letter-spacing: 1px; }
.badge.copy { border-color: #8996a2; color: #5d6b78; }
.dt { font-size: ${z(15)}; font-weight: 700; margin: 6px 0 6px; letter-spacing: 1px; text-transform: uppercase; }
.keys { display: flex; gap: 8px; justify-content: flex-end; }
.key { border: 2px solid ${B}; border-radius: 5px; padding: 4px 12px; text-align: center; min-width: 34mm; }
.key span { display: block; font-size: ${z(7.5)}; text-transform: uppercase; letter-spacing: .8px; color: #5d6b78; font-weight: 700; }
.key b { font-size: ${z(17)}; color: ${D}; letter-spacing: .5px; }
.key .rev { font-size: ${z(7.5)}; color: #8a5a00; text-transform: none; letter-spacing: 0; margin-top: 1px; }
.kind { font-size: ${z(9)}; color: #5d6b78; margin-top: 5px; }
.parties { display: flex; gap: 12px; margin: 14px 0; }
.box { flex: 1; border: 1px solid #bcd9ea; border-radius: 4px; padding: 8px 10px; line-height: 1.55; font-size: ${z(9.5)}; }
.box:first-child { flex: 1.6; }
.lbl { font-size: ${z(7.5)}; text-transform: uppercase; letter-spacing: .8px; color: #5d6b78; font-weight: 700; margin-bottom: 3px; }
.cn { font-weight: 700; font-size: ${z(11)}; }
.dorm { font-size: ${z(11)}; }
table { width: 100%; border-collapse: collapse; font-size: ${z(9.5)}; }
th { background: ${B}; color: #fff; font-weight: 600; padding: 6px 7px; text-align: left; font-size: ${z(8.5)}; }
td { padding: 5px 7px; border-bottom: 1px solid #dbe9f1; }
tbody tr:nth-child(even) { background: #eef7fc; }
.n { width: 24px; color: #5d6b78; }
.sum { display: flex; justify-content: flex-end; margin-top: 10px; }
.tot { width: 42%; border-collapse: collapse; font-size: ${z(10)}; }
.tot td { padding: 5px 8px; border-bottom: 1px solid #dbe9f1; background: none !important; }
.tot .due td { background: ${D} !important; color: #fff; font-weight: 700; font-size: ${z(11)}; border: none; }
.note { margin-top: 12px; font-size: ${z(8.5)}; font-weight: 600; color: #3e4a56; }
.sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 40px; margin-top: 40px; }
.s { font-size: ${z(9)}; font-weight: 600; color: #3e4a56; }
.s i { display: block; border-bottom: 1px solid #1a2430; height: 28px; margin-bottom: 4px; }
.ack { margin-top: 14px; font-size: ${z(8.5)}; text-align: center; font-style: italic; color: #3e4a56; }
footer { text-align: center; font-size: ${z(8)}; color: #8996a2; border-top: 1px solid #dbe9f1; padding-top: 5px; }
`;
      },
      page(c) {
        const { s, e } = c;
        const company = `<h1>${e(s.company_name)}</h1><div class="tag">${e(s.company_tagline)}</div>
    <div class="addr">${Receipt.addr(c, ' &nbsp;·&nbsp; ')}</div>`;
        return `<header>
  <div>${c.logo ? `<div class="brand">${c.logo}<div>${company}</div></div>` : company}</div>
  <div class="doc">${c.badge}<div class="dt">${c.title}</div>
    <div class="keys"><div class="key"><span>Invoice No</span><b>${c.no}</b>
      ${c.rev}</div>
    <div class="key"><span>Date</span><b>${c.date}</b></div></div><div class="kind">${c.kind}</div></div>
</header>
<div class="parties">
  ${Receipt.billTo(c)}
  ${Receipt.delivery(c)}
</div>
${c.table}
<div class="sum">${Receipt.totals(c)}</div>
${Receipt.amountWords(c)}
${Receipt.bottom(c)}`;
      },
    },

    // Like the original Excel receipt: centred header, one line with Original / title / number / date,
    // a bordered table with a coloured header, and a bordered totals box on the right.
    classic: {
      css(f, z, B, D, n) {
        return `
.hd { text-align: center; padding-bottom: 4px; }
.logo { display: block; height: 18mm; width: auto; max-width: 70mm; object-fit: contain; margin: 0 auto 4px; }
h1 { margin: 0; font-size: ${z(21)}; letter-spacing: .5px; color: ${D}; }
.tag { font-size: ${z(9.5)}; font-style: italic; color: #3e4a56; margin: 2px 0 5px; }
.addr { font-size: ${z(9)}; line-height: 1.5; color: #3e4a56; }
.line { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0 12px; padding: 7px 12px;
  border: 1.5px solid ${B}; background: ${Receipt.lighten(B, 0.9)}; font-size: ${z(10.5)}; }
.line .t { font-size: ${z(15)}; font-weight: 700; color: ${D}; }
.line .kind { font-size: ${z(9)}; color: #5d6b78; font-weight: 400; margin-left: 6px; }
.line b { font-size: ${z(12)}; color: ${D}; }
.badge { border: 1.5px solid ${D}; color: ${D}; padding: 1px 8px; font-weight: 700; font-size: ${z(9)}; letter-spacing: 1px; background: #fff; }
.badge.copy { border-color: #8996a2; color: #5d6b78; }
.rev { display: block; font-size: ${z(7.5)}; color: #8a5a00; text-align: right; }
.parties { display: flex; gap: 12px; margin-bottom: 12px; }
.box { flex: 1; border: 1px solid #7d8a96; padding: 7px 10px; line-height: 1.55; font-size: ${z(9.5)}; }
.box:first-child { flex: 1.6; }
.lbl { font-size: ${z(8)}; text-transform: uppercase; letter-spacing: .6px; color: ${D}; font-weight: 700; margin-bottom: 3px; }
.cn { font-weight: 700; font-size: ${z(11)}; }
.dorm { font-size: ${z(11)}; }
table.items { width: 100%; border-collapse: collapse; font-size: ${z(9.5)}; border: 1.5px solid #4a5560; }
.items th { background: ${B}; color: #fff; font-weight: 700; padding: 6px 7px; text-align: left; font-size: ${z(8.5)}; border: 1px solid #4a5560; }
.items td { padding: 5px 7px; border: 1px solid #a9b4be; }
.n { width: 26px; text-align: center; }
.sum { display: flex; justify-content: flex-end; margin-top: 10px; }
.tot { width: 42%; border-collapse: collapse; font-size: ${z(10)}; border: 1.5px solid #4a5560; }
.tot td { padding: 5px 8px; border: 1px solid #a9b4be; }
.tot .due td { background: ${B}; color: #fff; font-weight: 700; font-size: ${z(11)}; border-color: #4a5560; }
.note { margin-top: 12px; font-size: ${z(8.5)}; font-weight: 600; color: #3e4a56; }
.sigs { display: grid; grid-template-columns: repeat(${n <= 4 ? Math.max(n, 1) : 3}, 1fr); gap: 30px 28px; margin-top: 40px; }
.s { font-size: ${z(9)}; font-weight: 600; color: #3e4a56; text-align: center; }
.s i { display: block; border-bottom: 1px solid #1a2430; height: 28px; margin-bottom: 4px; }
.ack { margin-top: 14px; font-size: ${z(8.5)}; text-align: center; font-style: italic; color: #3e4a56; }
footer { text-align: center; font-size: ${z(8)}; color: #5d6b78; border-top: 1px solid #a9b4be; padding-top: 5px; }
`;
      },
      page(c) {
        const { s, e } = c;
        return `<div class="hd">${c.logo}<h1>${e(s.company_name)}</h1><div class="tag">${e(s.company_tagline)}</div>
  <div class="addr">${Receipt.addr(c, ' &nbsp;·&nbsp; ')}</div></div>
<div class="line">${c.badge}<span class="t">${c.title}<span class="kind">${c.kind}</span></span>
  <span>No: <b>${c.no}</b>${c.rev}</span><span>Date: <b>${c.date}</b></span></div>
<div class="parties">
  ${Receipt.billTo(c, 'Bill To')}
  ${Receipt.delivery(c)}
</div>
${c.table}
<div class="sum">${Receipt.totals(c)}</div>
${Receipt.amountWords(c)}
${Receipt.bottom(c)}`;
      },
    },

    // Black and white with thin lines: saves ink, prints well on any printer.
    simple: {
      css(f, z) {
        return `
body { color: #000; }
header { display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 8px; }
.brand { display: flex; gap: 12px; align-items: flex-start; }
.logo { height: 18mm; width: auto; max-width: 45mm; object-fit: contain; filter: grayscale(1); }
h1 { margin: 0; font-size: ${z(18)}; letter-spacing: .5px; }
.tag { font-size: ${z(8.5)}; margin: 2px 0 5px; }
.addr { font-size: ${z(8.5)}; line-height: 1.5; }
.doc { text-align: right; font-size: ${z(9.5)}; line-height: 1.6; }
.badge { display: inline-block; border: 1px solid #000; font-size: ${z(7.5)}; font-weight: 700; padding: 1px 7px; letter-spacing: 1px; }
.badge.copy { border-style: dashed; }
.dt { font-size: ${z(14)}; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin: 4px 0 2px; }
.doc b { font-size: ${z(11)}; }
.rev { display: block; font-size: ${z(7.5)}; }
.parties { display: flex; gap: 24px; margin: 12px 0; }
.box { flex: 1; line-height: 1.55; font-size: ${z(9.5)}; }
.box:first-child { flex: 1.6; }
.lbl { font-size: ${z(7.5)}; text-transform: uppercase; letter-spacing: .8px; font-weight: 700; border-bottom: .5px solid #000; margin-bottom: 4px; padding-bottom: 2px; }
.cn { font-weight: 700; font-size: ${z(11)}; }
.dorm { font-size: ${z(10.5)}; }
table.items { width: 100%; border-collapse: collapse; font-size: ${z(9.5)}; }
.items th { text-align: left; font-size: ${z(8.5)}; padding: 5px 6px; border-top: 1px solid #000; border-bottom: 1px solid #000; }
.items td { padding: 5px 6px; border-bottom: .5px solid #999; }
.n { width: 24px; }
.sum { display: flex; justify-content: flex-end; margin-top: 10px; }
.tot { width: 42%; border-collapse: collapse; font-size: ${z(10)}; }
.tot td { padding: 4px 8px; }
.tot .due td { border-top: 1px solid #000; border-bottom: 1px solid #000; font-weight: 700; font-size: ${z(11)}; }
.words { color: #000; }
.note { margin-top: 12px; font-size: ${z(8.5)}; }
.sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 30px 40px; margin-top: 40px; }
.s { font-size: ${z(9)}; }
.s i { display: block; border-bottom: .5px solid #000; height: 28px; margin-bottom: 4px; }
.ack { margin-top: 14px; font-size: ${z(8.5)}; text-align: center; font-style: italic; }
footer { text-align: center; font-size: ${z(8)}; border-top: .5px solid #000; padding-top: 5px; }
`;
      },
      page(c) {
        const { s, e } = c;
        const company = `<h1>${e(s.company_name)}</h1><div class="tag">${e(s.company_tagline)}</div>
    <div class="addr">${Receipt.addr(c, ' · ')}</div>`;
        return `<header>
  <div>${c.logo ? `<div class="brand">${c.logo}<div>${company}</div></div>` : company}</div>
  <div class="doc">${c.badge}<div class="dt">${c.title}</div>
    Invoice No: <b>${c.no}</b>${c.rev}<br>Date: <b>${c.date}</b><br>${c.kind}</div>
</header>
<div class="parties">
  ${Receipt.billTo(c)}
  ${Receipt.delivery(c)}
</div>
${c.table}
<div class="sum">${Receipt.totals(c)}</div>
${Receipt.amountWords(c)}
${Receipt.bottom(c)}`;
      },
    },
  },

  css(s) {
    const f = Receipt.fmt(s);
    const k = Receipt.TEXT[f.text_size];
    const z = (n) => `${+(n * k).toFixed(2)}pt`;
    const B = f.color;
    const sigs = f.show.signatures ? f.signatures.length : 0;
    return Receipt.baseCss(f, z) + Receipt.templates[f.template].css(f, z, B, Receipt.darken(B), sigs) + Receipt.sigCss(f, z, sigs);
  },

  // Where the signature lines go (Settings → Receipt format → Signatures → Position). Same for every template.
  sigCss(f, z, n) {
    const [, ms, mb, fb] = Receipt.MARGINS[f.margins];
    const footer = f.show.footer && f.footer;
    const row = `grid-template-columns: repeat(${Math.max(n, 1)}, minmax(0, 1fr)); column-gap: ${n > 4 ? 16 : 26}px;`;
    return `
.sigs { align-items: end; }
.sigs.pos-row { ${row} }
.sigs.pos-two, .sigs.pos-excel { grid-template-columns: 1fr 1fr; }
.sigs.pos-excel .s:nth-child(n+3) { grid-column: 2; }
.sigs.pos-left, .sigs.pos-right { grid-template-columns: 48%; row-gap: 26px; }
.sigs.pos-right { justify-content: end; }
.sigblock.pinned { position: absolute; left: ${ms}mm; right: ${ms}mm; bottom: ${footer ? `calc(${fb}mm + 26px)` : `${mb}mm`}; }
.sigblock.pinned .sigs { ${row} margin-top: 0; }
.nm { font-size: ${z(9)}; font-weight: 400; margin-bottom: 2px; text-align: left; }
.nm b { font-weight: 700; }
.nm .blank { display: inline-block; width: 62%; height: 1.1em; border-bottom: 1px solid currentColor; vertical-align: bottom; }
`;
  },

  // inv: invoice from getWeek(); week: week row; products: list; label: 'ORIGINAL' | 'COPY'
  page(s, week, inv, products, label) {
    const c = Receipt.ctx(s, week, inv, products, label);
    return `<section class="page"><div class="sheet">
${Receipt.templates[c.f.template].page(c)}
</div></section>`;
  },

  // Long invoices must stay on one page: if a page runs past its bottom (or into the footer),
  // make the item rows a little lower, then the item text a little smaller, until it fits.
  // Runs inside the printed document (and on previews, from the screen).
  fit: function (doc) {
    var win = doc.defaultView;
    var sheets = doc.querySelectorAll('.sheet');
    for (var k = 0; k < sheets.length; k++) {
      var sh = sheets[k];
      var tds = sh.querySelectorAll('table.items td');
      if (!tds.length) continue;
      var foot = sh.querySelector('footer');
      var pin = sh.querySelector('.sigblock.pinned');   // signatures pinned to the bottom: stop above them
      var limit = pin ? pin.offsetTop - 12
        : foot ? foot.offsetTop - 6 : sh.clientHeight - parseFloat(win.getComputedStyle(sh).paddingBottom);
      var bottom = function () {
        var b = 0;
        for (var i = 0; i < sh.children.length; i++) {
          var el = sh.children[i];
          if (el.tagName === 'FOOTER' || el.classList.contains('wm') || el === pin) continue;
          b = Math.max(b, el.offsetTop + el.offsetHeight);
        }
        return b;
      };
      if (bottom() <= limit) continue;
      var base = parseFloat(win.getComputedStyle(tds[0]).fontSize);
      var sigs = pin ? null : sh.querySelector('.sigs');
      // [row padding in px, item text size, signature spacing: 0 as designed, 1 closer, 2 tight, 3 tightest]
      var steps = [[4, 1, 0], [3, 1, 0], [2, 1, 0], [2, 1, 1], [1.5, 1, 1], [1, 1, 1], [1, 1, 2], [0.5, 1, 2], [0.5, 1, 3],
        [0.5, 0.95, 3], [0.5, 0.9, 3], [0, 0.85, 3], [0, 0.8, 3], [0, 0.75, 3]];
      var lines = sigs ? sigs.querySelectorAll('.s i') : [];
      var ack = sh.querySelector('.ack');
      for (var j = 0; j < steps.length && bottom() > limit; j++) {
        for (var t = 0; t < tds.length; t++) {
          tds[t].style.paddingTop = tds[t].style.paddingBottom = steps[j][0] + 'px';
          if (steps[j][1] !== 1) tds[t].style.fontSize = (base * steps[j][1]) + 'px';
        }
        if (sigs && steps[j][2] === 1) { sigs.style.marginTop = '20px'; sigs.style.rowGap = '18px'; }
        if (sigs && steps[j][2] >= 2) {
          var tight = steps[j][2] === 3;
          sigs.style.marginTop = tight ? '10px' : '14px'; sigs.style.rowGap = tight ? '4px' : '8px';
          for (var q = 0; q < lines.length; q++) lines[q].style.height = tight ? '14px' : '20px';
          if (tight && ack) ack.style.marginTop = '8px';
        }
      }
    }
  },

  // script: false for previews on screen (the app does not allow scripts inside them; call fit instead).
  doc(s, pagesHtml, title = 'Invoices', { script = true } = {}) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${U.esc(title)}</title><style>${Receipt.css(s)}</style></head><body>${pagesHtml}${
      script ? `<script>window.addEventListener('load', function () { (${Receipt.fit.toString()})(document); });</script>` : ''}</body></html>`;
  },

  // labels: ['ORIGINAL'] / ['COPY'] / ['ORIGINAL','COPY']
  build(s, week, invoices, products, labels, opts) {
    const pages = invoices.map((inv) => labels.map((l) => Receipt.page(s, week, inv, products, l)).join('')).join('');
    return Receipt.doc(s, pages, 'Invoices', opts);
  },

  // Show a receipt in an iframe preview (no script) and fit long invoices like the print does.
  show(frame, html, after) {
    frame.onload = () => { if (frame.contentDocument) Receipt.fit(frame.contentDocument); if (after) after(); };
    frame.srcdoc = html;
  },
};
