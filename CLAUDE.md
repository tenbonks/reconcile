# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A client-side browser tool that matches rows across CSV files and exports the main file with match flags and copied values. No server, no build step, no bundler, no package manager, no tests. The only network dependency is PapaParse from cdnjs (CSV parse/unparse).

## Running it

Open `index.html` in a browser. There is nothing to build or install. To avoid `file://` quirks serve the folder statically:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Architecture

Three files, split by concern, loaded directly by the browser:

- `index.html` — static markup for the three stages (files, rules, run). Every interactive element the script needs has a fixed `id`; the JS binds to those ids via `$('#id')`. Changing an id in one file requires changing it in the other.
- `assets/reconcile.js` — all behaviour, one classic script wrapped in an IIFE. Rule cards, strategies and results are built with `el()` and re-rendered wholesale (`renderRules()` / `replaceCard()`), not patched.
- `assets/style.css` — all styling. The `:root` block holds the Web Sights brand tokens (`--color-primary`, `--color-secondary` …) and the semantic aliases components use (`--bg`, `--surface`, `--accent`, `--text2` …). Components only reference the aliases.

Core data flow in `reconcile.js`: a module-level `S` object is the single source of truth — `S.main` (parsed main file), `S.lookups` (parsed reference files, each with an `id`), `S.rules`, `S.output`. Pipeline: `parseFile()` → `loadMain()`/`loadLookups()` → user edits `S.rules` through the cards → `process()` runs `runRule()` per rule → `S.output = {headers, rows, newCols, perRule}` → `renderStats()`/`renderPreview()`/`renderUnmatched()` → `outputCSV()`.

Things worth knowing before editing:

- **Rules reference lookups by runtime `id`, never by name.** A rule with `lookupId: null` is unbound: its "Match against" select shows the placeholder and its reference-column selects are disabled. Removing a reference file sets `lookupId = null` on every rule that used it; adding one binds any unbound rules to it. Setups (`serialize()`/`applyConfig()`) deliberately omit the reference file — loading a setup binds each rule to `S.lookups[0]` if present.
- **Strategies are OR'd, conditions are AND'd.** `runRule()` walks `rule.strategies` in order and stops at the first with ≥1 candidate (or exactly 1 when `requireUnique`). Strategies whose conditions all use equality operators (`EQ` set) get a hash index from `buildIndex()`; others fall back to a linear scan with `testCond()`.
- **Blank never matches.** `norm()` returns `''` for blank/unparseable values, and both `buildIndex()` and the per-row lookup skip empty keys, so an empty cell on either side is never a match.
- **Old saved setups may contain `lookupName`.** It is ignored on load.
- **Downloads go through `window.claude.use('downloads')` when available**, falling back to a Blob anchor. `saveFile()` handles both.
