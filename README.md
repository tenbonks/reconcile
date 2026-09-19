# Reconcile

A browser-based tool for matching rows across CSV files. Load a main file and one or more reference files, define how rows should match, then export the main file with match flags and values pulled from the matched reference rows. No server, no uploads. Everything runs locally in the browser.

---

## Features

- **Multiple reference files** — match a main file against as many reference files as you need, each with its own rules
- **Ordered strategies** — each rule tries its strategies top-to-bottom; the first that finds a match wins (`Strategy 1` OR `Strategy 2` OR …)
- **Compound conditions** — a strategy can require several column comparisons at once (`email` AND `postcode`)
- **Match operators** — trim + ignore case, ignore case, exact, contains, starts with, numeric equal
- **Ambiguity guard** — optionally reject a strategy when it matches more than one reference row
- **Match flag column** — adds a `TRUE`/`FALSE` column per rule
- **Match method column** — records which strategy produced the match
- **Copy values** — pull any reference columns into new columns on the main file
- **Unmatched inspector** — per-row breakdown of what each strategy looked for, plus a "find closest reference row" search (Levenshtein) to spot near-misses like typos or stray whitespace
- **Saved setups** — save rule configurations to the browser, or export/import them as JSON. Setups store rules and column names only, never the files themselves
- **Output preview** — first 200 rows, new columns highlighted
- **Download or copy** — export as `<main>.reconciled.csv` or copy CSV to the clipboard
- **100% client-side** — no data ever leaves the browser

---

## Usage

1. Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari)
2. Drop a **main file** — the file that will be exported with new columns
3. Drop one or more **reference files** to match against
4. Add a **rule**: pick the reference file, name it, and define one or more match strategies
5. Choose what to add on match: a flag column, a method column, and/or copied values
6. Click **Run matching**, review the stats and the **Unmatched** tab
7. **Download CSV** or **Copy CSV**

Click **Load an example** in the Files stage to see a worked setup.

---

## Rules, Strategies and Conditions

```
Rule "CRM lookup"  — matches against crm_export.csv
  Strategy "Email"       email_address  ≈ email      (trim + ignore case)
  OR
  Strategy "Name + DOB"  last_name      ≈ surname    (trim + ignore case)
                     AND dob            = birth_date (exact)
```

For each main row, strategies are tried in order. Within a strategy, every condition must pass. Blank values on either side never match. With **require unique** on (the default), a strategy that matches two or more reference rows is skipped and the row is counted as *ambiguous*.

Equality operators (`trim`, `ignore case`, `exact`, `numeric`) are indexed, so large files match in linear time. `contains` and `starts with` scan the reference file per row.

---

## Setups

A setup is a JSON snapshot of the rules: names, strategies, conditions, output columns. It does **not** include the reference file — when a setup is loaded, each rule is pointed at the first loaded reference file, and you can re-pick from the dropdown. Removing a reference file clears it from every rule that used it.

Setups saved in the browser live in `localStorage` under `reconcile.setups.v1`.

---

## Browser Compatibility

Any modern browser with `File`, `Blob` and Clipboard support. CSV parsing uses [PapaParse](https://www.papaparse.com/) from cdnjs — the only network dependency.

---

## Project Structure

```
index.html            — markup
assets/style.css      — styles and brand tokens
assets/reconcile.js   — all behaviour
assets/img/           — web-sights logo
favicons/             — icons and web manifest
```

---

A tool by [Web Sights](https://web-sights.co.uk).
# reconcile
