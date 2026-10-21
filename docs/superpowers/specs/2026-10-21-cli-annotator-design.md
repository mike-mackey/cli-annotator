# CLI annotator — design

Date: 2026-10-21. Status: draft for review.

## Purpose

Annotate a real device configuration dump (`display current-configuration` output) with the DTE and
topology meaning of each line, using the **annotation bundle** that ontology-ui exports from the CLI page
(`docs/topo-cli-bundle.md` in ontology-ui). An engineer drops in a dump and a bundle and sees which lines
configure which DTE entity fields and which topology entities they correspond to. They also see what the
mappings don't cover yet.

Success: for the sample dumps (`ontology-ui/Sample Ontologies/cli/dumps/device_207…210.txt`), every
mapped command present in the dump is annotated. This includes GigabitEthernet and 25GE interfaces,
although the mappings were made on 100GE views. The result exports as an HTML report, JSON instances and
annotated text.

## Constraints

- **Client-side only.** The dumps hold secrets (`irreversible-cipher` passwords, RSA public keys,
  `%^%#…%^%#` encrypted strings). Nothing is uploaded and no server is needed; the app is static files.
  Dumps are never written to browser storage.
- **Version tolerance.** The dumps are V800R025C10SPC500 and the bundle is V800R022C00SPC600. A version or
  device mismatch is a warning, never a refusal.
- **The bundle is the only model input.** The annotator never calls ontology-ui's API.
- Stack follows ontology-ui: Vite + React, plain JS, `node --test` for the core, one CSS file.

## Prerequisite: bundle format v2 (ontology-ui)

Interface equivalence needs the entry command of every catalogue view, not only the views the mappings
use. ontology-ui changes:

- `server/cli.js` gets `getAllViewPaths(pkgId)`, exposed as `GET /api/cli/view-paths/:packageId`. It
  returns `{status, paths: {viewName: path}}` and is built from `viewParentMap` and `resolveViewPath`.
- `buildAnnotationBundle` takes `allViewPaths` and adds:

```jsonc
"viewIndex": {
  "ge sub-interface view": { "entryCommand": "interface GigabitEthernet <interface-number>.<sub-number>",
                             "params": ["interface-number", "sub-number"], "parentView": "system view" },
  "is-is view": { "entryCommand": null, "params": [], "parentView": "system view",
                  "enteredBy": ["6b485d79…"] }    // featureIds whose enableViews list this view
}
```

  `enteredBy` is filled from the bundle's own `commands`, where a command's `enableViews` names the view;
  the server's entry index is too noisy to use for this.
- `formatVersion` becomes 2. `views` stays as before.
- `docs/topo-cli-bundle.md` and its tests are updated to match.

The annotator also accepts v1 bundles. With no `viewIndex`, it works only from `views` and warns that
interface equivalence is limited to the mapped views.

## Approach

A pure JS core in `src/lib/` does all parsing and matching on plain data and has no React or DOM
dependencies. React only renders the core's output and starts downloads. This keeps the matching logic
testable on fixtures, and a Node CLI could reuse it later. (A CLI-only tool and a page inside ontology-ui
were considered and rejected: the first has no paste-and-view, and the second couples the annotator to
the app.)

## Core pipeline (`src/lib/`)

Each module is one step with its own tests.

1. **`bundle.js`: `loadBundle(json)`** checks `format` and `formatVersion` (1 or 2) and builds the lookups:
   - view → mappings
   - featureId → command
   - view → entry matcher
   - interface-view classes

   It throws a readable error on a wrong format.
2. **`parseConfig.js`: `parseConfig(text)`** returns
   `{softwareVersion, blocks, lines}`.
   - Lines starting with `!` are header or comment lines. The `!Software Version …` line gives
     `softwareVersion`.
   - A top-level line opens a block; its more-indented lines are children, and nested indentation opens
     nested blocks. A lone ` #` at child depth closes the current sub-block.
   - `#` lines at the top level separate blocks; `return` ends the configuration.
   - Every line keeps its 1-based number and raw text. CRLF input is accepted.
3. **`syntax.js`: `compileSyntax(syntax)`** turns one catalogue syntax string into a matcher:
   - Supported notation: literal keywords, `<param>`, `[ optional ]`, `{ a | b }` (nesting allowed), a
     trailing `*` (repeatable group) and `&<1-n>` (repeat a value).
   - `match(line)` returns the captured `{param: value}` or null.
   - Keywords match case-insensitively, as whole tokens.
   - A `<param>` captures one token.
   - An interface-type keyword followed by `<interface-number>` also matches the joined dump form
     (`GigabitEthernet0/2/1`).
   - Unsupported notation degrades to "keyword prefix only" and is reported, never thrown.
4. **`interfaces.js`** reads the interface-type keyword (`GigabitEthernet`, `25GE`, `100GE`, `Eth-Trunk`,
   `LoopBack`, `Tunnel`, …) from each `viewIndex` entry command and gives each interface view a
   **shape**:
   - `main`: `interface T <n>`
   - `sub`: `interface T <n>.<s>`
   - `l2sub`: `interface T <n>.<s> mode l2`

   It also builds `typeOf(name)`, which splits a dump name like `25GE0/2/8.3` into type, number and
   sub-number. The longest known type keyword wins, and matching is case-insensitive.
5. **`resolveViews.js`: `resolveViews(blocks, bundle)`** gives each block opener a list of **candidate
   views**:
   - **exact**: the opener matches a view's entry command, or matches a command in that view's
     `enteredBy`.
   - **equivalent**: the opener is an interface of type T and shape S. Every *mapped* interface view of
     shape S is added as an equivalent candidate, labelled with the view it stands in for, e.g.
     `GigabitEthernet0/2/1.77` in `ge sub-interface view`, using mappings from `100ge sub-interface view`.
     This is on by default and can be switched off in the UI.

   Nested blocks resolve against the views whose parent is the enclosing view. Top-level lines sit in
   `system view`. Lines in an unresolved block are only checked against the `all views` pseudo-view.
6. **`matchLines.js`** matches each line against the syntax of the command mappings for every candidate
   view of its block, plus `all views` and `system view` for top-level lines. A line can match several
   mappings. The result is `{line, view, via: 'exact'|'equivalent', mapping, values}`, where `values`
   holds the mapping's `cliParameter` value when that parameter was captured.

   View and view-family mappings attach to the block opener and use its entry parameters, so the
   `interface-number` of `interface GigabitEthernet0/2/1` is the DTE field of the LTP name mapping.
7. **`buildInstances.js`** produces one **instance** per (block, DTE entity):
   - Key-mapping values (`isKey`) name it. Without a key, the block opener names it.
   - Other matched values become `fields: {dteField: value}`. One value has several lines, a field
     collects all of them.
   - `topology` is the bundle's candidates for that DTE entity. When a block also matches a mapping whose
     DTE entity is linked only to a subset of those candidates, the candidates are narrowed to that
     subset. For example, `isis enable` narrows LTP → `isisinterface`. The full candidate list is kept as
     `topologyCandidates`.
8. **`redact.js`** masks the secret value on a line and keeps its keyword, e.g.
   `irreversible-cipher ****`. It covers:
   - `cipher` / `irreversible-cipher` / `password` / `authentication` values
   - `%^%#…%^%#` strings
   - `public-key-code begin … end` bodies
   - `snmp-agent community` strings

   Redaction is applied to all exports by default; there is a toggle.
9. **`annotate.js`: `annotate(text, bundle, options)`** runs the whole pipeline and returns:
   - `{device, warnings[], lines[], instances[], unmatched, coverage}`
   - `lines[i]`: the line's text, its block's view or views, and the matches on it.
   - `coverage`: mapped commands found vs. bundle mappings, plus blocks whose view is unknown.

## Outputs (`src/lib/export/`)

- **JSON instances:**
  `{format: "cli-annotator.instances", version: 1, device, dumpFile, bundle: {device, generatedAt},
  warnings, instances: [{id, block, view, via, dte: {id, entity, fields}, topology, topologyCandidates,
  lines: [n]}]}`.
- **Annotated text:** the dump unchanged, with a comment line `! @ DTE <Entity>.<field>=<value> | topo
  <entity>[, …] [≈ <view>]` after each matched line and an `! @ <Entity> <key>` line after each instance's
  block opener. The `!` prefix keeps the output a valid comment in device syntax.
- **HTML report:** one self-contained file (inline CSS, no scripts needed to read it):
  - a header with the device and versions, plus the warnings
  - coverage figures
  - an instances table
  - the full dump, with matched lines highlighted and annotation notes in the margin
  - the bundle's `gaps` (DTE entities with no CLI mapping, topology entities with no DTE mapping)

All three downloads use the redaction setting.

## Web page (`src/`)

One page with three areas:

- **Inputs bar**:
  - drop or pick one or more dump files, or paste text
  - drop or pick a bundle file
  - toggles for interface equivalence and for redaction
  - the bundle's file name and generation time can be remembered in localStorage (the bundle itself is
    re-dropped, since it is device data too)

  Switching between several dumps uses a tab per dump.
- **Annotated dump** (centre): line numbers and the dump text.
  - A matched line has a coloured left bar (solid for exact, dashed for equivalent) and an inline chip
    `LTP.name`.
  - Clicking a line opens the detail panel.
  - Filters: matched only, unmatched only, search.
- **Side panel**: the clicked line's command (title, syntax, parameter descriptions), each mapping (DTE
  entity and field, relation, value) and its topology entities. With no line selected, the panel shows
  the instances list, coverage, warnings and the bundle gaps.
- **Export** buttons: HTML report, JSON instances, annotated text.

## Errors

- A wrong bundle format, or invalid JSON, blocks annotation with a message that names the problem.
- A device or software-version mismatch, a v1 bundle and syntax that can only be matched as a prefix are
  warnings listed above the dump.
- A dump with no `!Software Version` header is still annotated.
- Lines the parser can't place are counted in `unmatched`. Nothing is ever fatal.

## Testing

- Each `src/lib` module is unit tested with `node --test` on small inline fixtures. The tests cover:
  - every piece of syntax notation, and joined interface names
  - CRLF input
  - nested blocks and ` #`
  - exact vs. equivalent view resolution
  - narrowing topology candidates from `isis enable`
  - redaction patterns
- One end-to-end test runs a hand-made, secret-free excerpt in the style of `device_207` against a
  trimmed bundle fixture. The excerpt has an IS-IS process, a GigabitEthernet sub-interface with
  `isis enable`, `ip binding vpn-instance` and `mpls l2vc`, and a vpn-instance.
- The real dumps are **not** copied into this repo, because they contain secrets. A manual check script,
  `scripts/check-dumps.mjs <bundle> <dump…>`, prints coverage for real files.
- The ontology-ui bundle v2 change gets unit tests there.

## Out of scope

- Annotating `display` command output other than the configuration (the catalogue has no output
  formats).
- Writing anything back to ontology-ui, or editing mappings.
- Walking DTE↔DTE relations; this follows the bundle's direct links only.
- Vendors other than Huawei VRP syntax.

## Project layout

```
cli-annotator/
  package.json  vite.config.js  index.html  eslint.config.js  README.md  CLAUDE.md
  src/main.jsx  src/App.jsx  src/App.css
  src/components/   InputsBar, DumpView, LineDetail, SummaryPanel, ExportBar
  src/lib/          bundle, parseConfig, syntax, interfaces, resolveViews, matchLines,
                    buildInstances, redact, annotate (+ *.test.js)
  src/lib/export/   json, text, html (+ tests)
  test/fixtures/    bundle-v2.json, device-excerpt.txt
  scripts/check-dumps.mjs
```
