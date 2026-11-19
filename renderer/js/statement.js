// The printed monthly statement for Gamma Construction (A4, flows onto extra pages if needed).
// Its look comes from settings.statement_format (Settings → Statement format).

const Statement = {
  build(s, m) {
    const e = U.esc;
    const f = s.statement_format;
    const B = f.color;
    const logo = f.logo && s.receipt_format.logo ? `<img class="logo" src="${s.receipt_format.logo}" alt="">` : '';
    const title = e(f.title.trim() || 'Monthly Statement');
    const D = Receipt.darken(B);
    const money = U.money;
    const weekDays = m.weeks.map((w) => Number(w.date.slice(8, 10)));
    const daysText = weekDays.length > 1
      ? `${weekDays.slice(0, -1).join(', ')} &amp; ${weekDays[weekDays.length - 1]}`
      : String(weekDays[0] || '');

    const rows = m.weeks.map((w) => w.rows.map((r, k) => `<tr>
        ${k === 0 ? `<td class="wk" rowspan="${w.rows.length}">${U.date(w.date)}</td>` : ''}
        <td>${e(r.dorm)}</td>
        <td class="c">${r.df ? `DF-${r.df.number}` : ''}</td><td class="r">${r.df ? money(r.df.total) : ''}</td>
        <td class="c">${r.inv ? `INV-${r.inv.number}` : ''}</td><td class="r">${r.inv ? money(r.inv.total) : ''}</td>
        <td class="r"><b>${money((r.df ? r.df.total : 0) + (r.inv ? r.inv.total : 0))}</b></td></tr>`).join('')
      + `<tr class="sub"><td></td><td>Week total</td><td></td><td class="r">${money(w.df_total)}</td><td></td>
         <td class="r">${money(w.inv_total)}</td><td class="r">${money(w.total)}</td></tr>`).join('');

    const sumRows = m.summary.map((r) => `<tr><td>${e(r.dorm)}</td><td class="c">${r.weeks}</td>
      <td class="r">${money(r.df)}</td><td class="r">${money(r.inv)}</td><td class="r"><b>${money(r.total)}</b></td></tr>`).join('');

    const company = `<div class="co">${e(s.company_name)}</div><div class="tag">${e(s.company_tagline)}</div>
      <div class="ad">${e(s.company_address)} · Tel: ${e(s.company_phone)} · BRN: ${e(s.company_brn)}<br>
      ${e(s.company_emails).split(',').map((x) => x.trim()).join(' · ')}</div>`;
    const head = `<div class="head"><div>${logo ? `<div class="brand">${logo}<div>${company}</div></div>` : company}</div>
      <div class="rt"><div class="dt">${title}</div><div class="key"><span>Period</span><b>${U.monthName(m.month)}</b></div></div></div>
      <div class="to"><b>${e(s.customer_name)}</b> — Dormitories · Weeks of ${daysText} ${U.monthName(m.month)}</div>`;

    const pay = m.payment
      ? `Date: <b>${U.date(m.payment.paid_date)}</b><br><br>Amount: <b>Rs ${money(m.payment.amount)}</b><br><br>Cheque / Ref: <b>${e(m.payment.reference || '—')}</b>`
      : 'Date: ____________________<br><br>Amount: Rs ________________<br><br>Cheque / Ref: ______________';

    // After the summary (or after the main table when there is no summary page).
    const closing = `${f.show_payment ? `<div class="pay"><div class="box"><div class="lbl">Amount due for ${U.monthName(m.month)}</div><div class="big">Rs ${money(m.total)}</div></div>
<div class="box"><div class="lbl">Payment received</div>${pay}</div></div>` : ''}
<div class="sigs"><div><i></i>For ${e(s.company_name)}</div><div><i></i>Received by (${e(s.customer_name)})</div></div>
${f.footer.trim() ? `<div class="foot">${e(f.footer)}</div>` : ''}`;

    const css = `
@page { size: A4; margin: 11mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1a2430; font-size: 9pt; }
.head { display: flex; justify-content: space-between; border-bottom: 3px solid ${B}; padding-bottom: 7px; }
.co { font-size: 18pt; font-weight: 800; color: ${D}; } .tag { color: ${B}; font-weight: 700; font-size: 7.5pt; text-transform: uppercase; }
.ad { font-size: 8pt; color: #5d6b78; margin-top: 3px; line-height: 1.45; }
.rt { text-align: right; } .dt { font-weight: 800; font-size: 12pt; letter-spacing: .5px; margin-bottom: 4px; text-transform: uppercase; }
.brand { display: flex; gap: 10px; align-items: flex-start; } .logo { height: 15mm; width: auto; max-width: 40mm; object-fit: contain; }
.foot { margin-top: 18px; padding-top: 5px; border-top: 1px solid #dbe9f1; text-align: center; font-size: 8pt; color: #8996a2; }
.close { margin-top: 6px; }
.key { display: inline-block; border: 2px solid ${B}; border-radius: 5px; padding: 2px 12px; text-align: center; }
.key span { display: block; font-size: 7pt; font-weight: 700; color: #5d6b78; text-transform: uppercase; } .key b { font-size: 13pt; color: ${D}; }
.to { margin: 7px 0; } .cards { display: flex; gap: 8px; margin-bottom: 7px; }
.cards div { flex: 1; border: 1px solid #bcd9ea; border-radius: 5px; padding: 5px 9px; }
.cards span { display: block; font-size: 7pt; font-weight: 700; color: #5d6b78; text-transform: uppercase; } .cards b { font-size: 12pt; color: ${D}; }
.cards .tot { background: ${D}; border-color: ${D}; } .cards .tot span, .cards .tot b { color: #fff; }
table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
th { background: ${B}; color: #fff; padding: 4px 6px; text-align: left; font-size: 8pt; -webkit-print-color-adjust: exact; }
td { padding: 2.2px 6px; border-bottom: 1px solid #e3edf3; }
.wk { font-weight: 700; color: ${D}; vertical-align: top; border-right: 1px solid #e3edf3; white-space: nowrap; }
.c { text-align: center !important; } .r { text-align: right !important; }
.sub td { background: #eef7fc; font-weight: 700; color: ${D}; border-bottom: 2px solid #bcd9ea; }
tfoot td { background: ${D}; color: #fff; font-weight: 800; padding: 5px 6px; font-size: 9.5pt; }
.p2 { page-break-before: always; } h3 { color: ${D}; margin: 12px 0 6px; } .p2 td { padding: 5px 6px; font-size: 9.5pt; }
.pay { display: flex; gap: 12px; margin-top: 16px; } .box { flex: 1; border: 1px solid #bcd9ea; border-radius: 5px; padding: 10px 12px; line-height: 1.3; }
.lbl { font-size: 7.5pt; font-weight: 700; color: #5d6b78; text-transform: uppercase; margin-bottom: 5px; } .big { font-size: 20pt; font-weight: 800; color: ${D}; }
.sigs { display: flex; gap: 40px; margin-top: 40px; font-weight: 700; color: #3e4a56; } .sigs div { flex: 1; }
.sigs i { display: block; border-bottom: 1px solid #222; height: 30px; margin-bottom: 4px; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement ${e(m.month)}</title><style>${css}</style></head><body>
${head}
<div class="cards"><div><span>Vegetables (DF)</span><b>Rs ${money(m.df_total)}</b></div>
  <div><span>Potatoes &amp; Onions (INV)</span><b>Rs ${money(m.inv_total)}</b></div>
  <div class="tot"><span>Total due</span><b>Rs ${money(m.total)}</b></div></div>
<table><thead><tr><th>Week</th><th>Dormitory</th><th class="c">DF No</th><th class="r">Vegetables (Rs)</th>
  <th class="c">INV No</th><th class="r">Pot. &amp; Onions (Rs)</th><th class="r">Total (Rs)</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">MONTH TOTAL</td><td class="r">${money(m.df_total)}</td><td></td><td class="r">${money(m.inv_total)}</td>
  <td class="r">${money(m.total)}</td></tr></tfoot></table>
${f.show_summary ? `<div class="p2">${head}
<h3>Summary by dormitory</h3>
<table><thead><tr><th>Dormitory</th><th class="c">Weeks</th><th class="r">Vegetables (Rs)</th><th class="r">Pot. &amp; Onions (Rs)</th>
  <th class="r">Total (Rs)</th></tr></thead><tbody>${sumRows}</tbody>
<tfoot><tr><td>TOTAL</td><td></td><td class="r">${money(m.df_total)}</td><td class="r">${money(m.inv_total)}</td>
  <td class="r">${money(m.total)}</td></tr></tfoot></table>
${closing}</div>` : `<div class="close">${closing}</div>`}</body></html>`;
  },
};
