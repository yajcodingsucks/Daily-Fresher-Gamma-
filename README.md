# Daily Fresher Invoices

Desktop app (Electron + SQLite) for Daily Fresher Ltd's weekly deliveries to the Gamma Construction dormitories.

- **DF** invoices = vegetables, **INV** invoices = onions & potatoes, one of each per dormitory per week (9 dorms → 18 invoices).
- Invoice numbers and dates are filled in automatically (last week + 7 days, numbers carry on with no gaps).
- One grid to type every dorm's quantities; prices set once per week; all totals calculated.
- Prints A4 invoices as **Original + Copy**, or saves them as PDF.
- Printed invoices are locked; corrections need an unlock with a reason (kept in a change log).
- Monthly statement for Gamma (per week, per dorm, totals) and "mark as paid".
- Works fully offline. Data is saved on the laptop, with automatic backups.

## Run it

You need [Node.js](https://nodejs.org) (LTS) and Git.

```bash
npm install     # first time only
npm start       # opens the app
npm test        # checks the business rules (numbering, totals, locking, statements)
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
  service.js          ALL business rules: numbering, dates, prices, totals, locking, statements
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
