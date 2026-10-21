# CLI annotator — design

Date: 2026-10-21. Status: approved 2026-10-21; refined while writing the implementation plan
(`docs/superpowers/plans/2026-10-21-cli-annotator.md`).

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
  The built page carries a Content-Security-Policy meta with `connect-src 'none'`, and `src/` has no
  `fetch` or XHR. Dumps are never written to browser storage.
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
2. **`parseConfig.js`: `parseConfig(text)`** returns `{softwareVersion, sysname, lines, blocks}`.
   - Lines starting with `!` are header or comment lines. The `!Software Version …` line gives
     `softwareVersion`; the `sysname` command gives `sysname`.
   - Every top-level config line opens a block (most have no children). A more-indented config line turns
     the config line before it into the opener of a nested block.
   - `#` lines are separators and `return` ends the configuration.
   - Every line keeps its 1-based number and raw text. CRLF input and a UTF-8 BOM are accepted.
3. **`syntax.js`: `compileSyntax(syntax)`** turns one catalogue syntax string into a matcher:
   - Supported notation: literal keywords, `<param>`, composite tokens such as
     `<interface-number>.<sub-number>`, `[ optional ]`, `{ a | b }` (nesting allowed), a trailing `*`
     (repeatable group) and `&<1-n>` (repeat a value; the first is captured).
   - `match(line)` returns the captured `{param: value}` or null. A reading must consume the whole line; the
     reading with the most literal keywords wins.
   - Keywords match case-insensitively, as whole tokens. A `<param>` captures one token.
   - A keyword followed by a parameter also matches the joined dump form (`GigabitEthernet0/2/1`,
     `LoopBack0`).
   - Each match has a step budget, so pathological syntax cannot hang the page.
   - Unsupported notation degrades to "keyword prefix only" (`prefixOnly`) and is reported as a warning,
     never thrown. A prefix-only match never resolves a view.
   - `compileCommand` picks the best of a command's syntax forms and skips `undo …` forms.
4. **`interfaces.js`** reads the interface-type keyword (`GigabitEthernet`, `25GE`, `100GE`, `Eth-Trunk`,
   `LoopBack`, `Tunnel`, …) from each `viewIndex` entry command and gives each interface view a
   **shape**:
   - `main`: `interface T <n>`
   - `sub`: `interface T <n>.<s>`
   - `l2sub`: `interface T <n>.<s> mode l2`

   It also parses a dump opener like `interface 25GE0/2/8.3` into type, number and sub-number. The longest
   known type keyword wins. Matching is case-insensitive and allows a space between type and number.
5. **`resolveViews.js`: `resolveViews(blocks, bundle, {equivalence})`** gives each block a list of
   **candidate views**, each `{view, via, realView}`:
   - **exact**: the opener matches a view's entry command, or matches a command in that view's
     `enteredBy`. Interface openers are exact in the interface views of their own type and shape.
   - **equivalent**: the opener is an interface of shape S and class C. Every *mapped* interface view of
     shape S and class C is added as an equivalent candidate, with `realView` naming the block's own view
     (null when the catalogue has no view of the block's own type and shape). For example,
     `GigabitEthernet0/2/1.77` sits in `ge sub-interface view` and uses the mappings of
     `100ge sub-interface view`. This is on by default and can be switched off in the UI.

     The class (`interfaceClass` in `interfaces.js`) keeps equivalence to interfaces that really are
     alike: the physical Ethernet types (`GigabitEthernet`, `XGigabitEthernet`, `GE`, `<n>GE`,
     `Ethernet`, any case) form one class; every other type (`Eth-Trunk`, `Tunnel`, `LoopBack`,
     `Vlanif`, `NULL`, …) is a class of its own, equivalent only to itself. A LoopBack therefore never
     uses a GE view's mappings.

   Non-interface openers resolve against the views whose `parentView` is in scope. Top-level scope is
   `system view`, and a null `parentView` counts as `system view`. A nested block's scope is its parent's
   candidates, and it inherits the `via` of the candidate it was found under. Exact candidates come before
   equivalent ones.

   Each block also gets an **owner**: itself when it resolved, else its parent's owner. Matches in an
   unresolved nested block belong to the enclosing instance.
6. **`matchLines.js`** matches lines against mappings. A match is
   `{n, block, view, via: 'exact'|'equivalent'|'enclosing'|'all', realView, mapping, params, value, prefixOnly}`.
   - A command mapping's **scope** is its command's `parentViews` plus the mapping's `view`. The first
     candidate in scope wins, so exact beats equivalent.
   - A block opener is matched in its parent's candidates (`system view` at the top level); other lines in
     their own block's candidates. A line can match several mappings.
   - **Enclosing fallback:** when no scoped mapping matches, the enclosing blocks are tried outwards with
     `via: 'enclosing'`, never reaching `system view`. This is how `route-distinguisher`, typed in the
     `ipv4-family` sub-block, reaches the VPN instance's mappings.
   - Mappings for `all views` are tried on every config line with `via: 'all'`, unresolved blocks included.
   - View-family mappings are not applied: the bundle names the family but carries no list of its member
     views. `loadBundle` drops them with a warning.
   - View mappings attach to the block opener and use its entry parameters, so the
     `interface-number` of `interface GigabitEthernet0/2/1` is the DTE field of the LTP name mapping. Their
     value is the `cliParameter` value, else the interface name, else the first parameter, else the opener
     text.
   - A command match's `value` is the captured `cliParameter` value, or null.
7. **`buildInstances.js`** produces one **instance** per (owner block, DTE entity):
   - A group with no key match joins the enclosing block's group for the same DTE entity, if there is one.
   - The name is the key match's value. Else it is the value of a field a key mapping of that entity uses
     (VRF `vrfName` from `ip binding vpn-instance`). Else the interface name, else the opener text.
   - Matched values become `fields: {dteField: [values]}`, deduplicated in line order.
   - `topologyCandidates` is the bundle's topology list for the DTE entity. `topology` narrows it to the
     union of two rules, and keeps all candidates when neither keeps any:
     - **Keyword:** candidates whose name contains a distinctive word of a matched command's title
       (`isis enable` → `isisinterface`).
     - **Schema:** candidates in the same topology schema as the topology of another DTE entity reached
       from the same block (`ip binding vpn-instance` → VRF → `l3vpninstance` → `l3vpnsap`).
8. **`redact.js`** masks the secret value on a line and keeps its keyword, e.g.
   `irreversible-cipher ****`. It covers:
   - `cipher` / `irreversible-cipher` / `simple` / `plain` / `password` / `authentication-mode` values
   - `%^%#…%^%#` strings and `$1x$…` hashes
   - `public-key-code begin … end` bodies
   - `snmp-agent community` strings

   Redaction runs **before** matching, so captured values, instance names, the page and every export are
   redacted. It is on by default; switching it off in the UI shows a warning next to the exports.
9. **`annotate.js`: `annotate(text, bundle, {equivalence = true, redact = true})`** runs the whole pipeline.
   `bundle` may be a JSON string, a parsed object or a loaded bundle. It returns:
   - `{options, device: {softwareVersion, sysname}, bundle, warnings[], lines[], blocks[], instances[], gaps,
     unmatched, coverage}`
   - `lines[i]`: the line's text, kind, whether it was redacted, its block's candidate views and the
     matches on it, each linked to its instance.
   - `unmatched`: config lines with no match.
   - `coverage`: mappings found vs. bundle mappings (and lines per mapping), matched vs. config lines,
     blocks and the blocks whose view is unknown.

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
  - A matched line has a coloured left bar (solid for exact, dashed for equivalent, dotted for enclosing
    or all views) and an inline chip `LTP.name`.
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
  src/files.js      read dropped files, download a Blob
  src/lastBundle.js remember the last bundle's name and time (+ browser.test.js)
  src/components/   InputsBar, DumpView, LineDetail, SummaryPanel, ExportBar
  src/lib/          bundle, parseConfig, syntax, interfaces, resolveViews, matchLines,
                    buildInstances, redact, annotate (+ *.test.js)
  src/lib/export/   json, text, html (+ export.test.js)
  test/fixtures/    bundle-v2.json, device-excerpt.txt
  scripts/check-dumps.mjs (+ test)
```
