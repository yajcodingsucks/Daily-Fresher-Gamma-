# Daily Fresher Invoices

Desktop app (Electron + SQLite) for Daily Fresher Ltd's weekly deliveries to the Gamma Construction dormitories.

- **DF** invoices = vegetables, **INV** invoices = onions & potatoes, one of each per dormitory per week (9 dorms → 18 invoices).
- Invoice numbers and dates are filled in automatically (last week + 7 days, numbers carry on with no gaps).
  When starting a week you can change the date and the first DF / INV number.
- Prints A4 invoices as **Original + Copy**, or saves them as PDF.
- Monthly statement for Gamma (per week, per dorm, totals) and "mark as paid".
- Works fully offline. Data is saved on the laptop, with automatic backups.

## What each screen does

**This Week** — always the latest week. One grid for the whole week:
- *INV · Onions & Potatoes* (gold) on top, *DF · Vegetables* (blue) below; items A→Z.
- Each dorm column shows its DF and INV number and a badge: ✓ Done / ✎ Typing… / Not started. Click it to open the invoice.
- Item and Price stay on the left, **Total qty** stays on the right, and the DF total, INV total and Vehicle rows stay at
  the bottom. The grid fills the window; only the grid scrolls.
- Grey numbers in empty boxes are **last week's quantities** — only a hint, never saved unless typed.
  **⟲ Copy last week's orders** fills every empty box with them (boxes that already have a number are never changed).
- Items nobody ordered in the last 4 weeks (or without a price) are hidden; "＋ Show N more items" shows them.
- Keys like Excel: Enter / ↓ down, ↑ up, Tab right, Shift+Tab left.
- **🖨 Print all** first shows a check: invoices and pages, DF / INV / week totals, empty invoices, prices that changed
  more than 30 % and quantities more than 3× the usual.
- Start next week, Save all as PDF, Unlock and Delete week are under **⋯ More**.

**History** — every week. *Open* shows the week's details: totals, vehicles, one row per dorm with its print status and
👁 View, 🖨 Reprint, 📄 PDF and ✏️ Edit. Reprinting (Original + Copy / Original only / Copy only) never changes anything
saved. *Correct this week* opens that week's grid with an "editing an old week" banner. Type `DF-505` in the search box to
open an invoice.

**Correcting an old invoice** — ✏️ Edit opens just that dorm's DF and INV invoice. Invoice numbers never change.
For a printed invoice you must write what needs correcting; the app keeps a copy of the invoice as it was, shows
"Corrected · was Rs X → now Rs Y" with a *See changes* list, and reprints show **"Revised DD.MM.YYYY"** under the number.
If the month is marked as paid, nothing in it can be changed until you undo paid on the Monthly page.

**Monthly** — the statement. The app remembers when it was printed and warns if an invoice changed after that,
so you know to reprint it.

**A− A A+** at the bottom of the menu makes all text smaller or bigger (remembered).

## Run it

You need [Node.js](https://nodejs.org) (LTS) and Git.

```bash
npm install     # first time only
npm start       # opens the app
npm test        # checks the business rules (numbering, totals, locking, corrections, statements)
```

Make a single `.exe` you can copy to any Windows laptop:

```bash
npm run dist    # creates dist/Daily Fresher Invoices <version>.exe
```

## Where the data is

`Documents\Daily Fresher Invoices\daily-fresher.db` — one SQLite file with everything.
Backups go to `Documents\Daily Fresher Invoices\backups\` every time the app opens and closes (newest 60 kept).
Copy that folder to a USB stick / Google Drive now and then. The database is **not** stored in Git (see `.gitignore`).

## First run

The app starts with the data from `Receipt Format02.xlsx`: 9 dormitories, 31 items with codes and prices,
and numbering that continues after **DF-502 / INV-353 (20.11.2026)** — so the first week is
**27.11.2026, DF-503 → DF-511, INV-354 → INV-362**. Change any of this in *Settings* and *Products & Prices*.

## How the code is organised

```
main/                 "backend" – runs in Node.js
  main.js             starts the app, printing, backups, connects screens to the rules
  preload.js          the safe bridge: the only functions the screens can call
  service.js          ALL business rules: numbering, dates, prices, totals, locking, corrections, statements
  schema.js           database tables (+ a trigger that keeps onions/potatoes off DF invoices)
  seed.js             starting data (dorms, items, prices, last numbers)
  store.js            small wrapper around SQLite (sql.js in the app, node:sqlite in tests)
  backup.js           backup copies of the database file
renderer/             "frontend" – the screens
  index.html, css/app.css
  js/app.js           switches between screens
  js/receipt.js       the printed A4 invoice
  js/statement.js     the printed monthly statement
  js/views/*.js       This Week, Invoices, Products & Prices, History, Monthly, Settings
test/
  service.test.js     automated tests for the business rules (npm test)
  ui-harness.js       runs the screens in a normal browser without Electron (for development)
```

The screens never touch the database directly — they ask `service.js`, which decides what is allowed.

Audit trail: everything sensitive is written to the `change_log` table — `printed`, `unlocked` (with the reason),
`corrected` (JSON with the reason and the invoice before and after) and `statement` (each statement print / PDF).

`scripts/start.js` starts Electron for `npm start`; it clears `ELECTRON_RUN_AS_NODE`, which some terminals
(e.g. VS Code's) set and which would stop the window from opening.
