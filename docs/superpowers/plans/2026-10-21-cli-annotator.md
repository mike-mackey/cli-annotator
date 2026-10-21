# CLI Annotator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side web page that annotates a Huawei `display current-configuration` dump with the DTE and topology meaning of each line, using ontology-ui's annotation bundle, and exports an HTML report, JSON instances and annotated text.

**Architecture:** A pure JS core in `src/lib/` (no React, no DOM) runs a pipeline: load bundle → parse config into blocks → redact → resolve each block's candidate views → match lines against command syntax → group matches into DTE instances. React only renders the result and starts downloads. ontology-ui first gains bundle format v2 (a `viewIndex` of every catalogue view), which interface equivalence needs.

**Tech Stack:** Vite 8 + React 19, plain JS (ES modules), `node --test`, ESLint 10 flat config, one CSS file.

**Spec:** `docs/superpowers/specs/2026-10-21-cli-annotator-design.md`

## Global Constraints

- Node via nvm, sourced in every shell: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"` (node v26).
- Use absolute paths in shell commands; the shell's cwd resets between calls.
- Task 1 runs in `/mnt/c/code/ontology-ui` on branch `cli-tracing`. Tasks 2–13 run in `/mnt/c/code/cli-annotator` on `main`.
- Every commit message ends with two trailer lines. Pass them as a second `-m`:
  `-m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'`
- Never commit `.claude/settings.local.json`. Never push or deploy.
- **Client-side only.** Nothing is uploaded, and no `fetch`/XHR exists in `src/`. The production build carries a CSP meta with `connect-src 'none'`. Dumps are never written to browser storage; only the bundle's file name and `generatedAt` are remembered.
- **Real dumps contain secrets.** They live in `/home/mike/c/code/ontology-ui/Sample Ontologies/cli/dumps/` and must never be copied into this repo (`.gitignore` has `dumps/`). Never print a dump line in a terminal, a test or a script: print counts, keywords and instance names only.
- A version or device mismatch is a warning, never a refusal. Nothing in the pipeline throws on dump input; only an invalid bundle throws.
- Supported bundle `formatVersion`s: 1 and 2. `format` must be `ontology-ui.topo-cli-annotation-bundle`.

## Review Focus

1. **A dump saved on Windows (CRLF line endings, UTF-8 BOM)** parses exactly like the LF original: same line count, no `\r` in text, header found. Test in Task 3.
2. **Interface names in other case or with a space** (`interface gigabitethernet 0/2/1`, `interface 100GE0/1/0`) resolve to the same view as the canonical form. Test in Task 5.
3. **A syntax with nested starred groups and many tokens** (pathological backtracking) returns within the step budget instead of hanging the page. Test in Task 4.
4. **A secret captured as a mapped parameter value** (`local-user admin password irreversible-cipher <x>` mapped to a DTE field) is masked in instances, line matches and every export when redaction is on. Test in Task 10.
5. **Dump text containing HTML** (`description <b>core</b> & "x"`) is escaped in the HTML report. Test in Task 11.

---

## File map

```
ontology-ui (Task 1)
  server/cliViewFamilies.js     + allViewPaths(pkg, viewParentMap)
  server/cli.js                 + getAllViewPaths(pkgId)
  server/index.js               + GET /api/cli/view-paths/:packageId
  src/utils/cliCatalogueApi.js  + getAllViewPaths(packageId)
  src/utils/topoCliBundle.js    + buildViewIndex, allViewPaths param, viewIndex, formatVersion 2
  src/components/CLIPage.jsx    handleAnnotationBundle fetches all view paths
  docs/topo-cli-bundle.md       format v2

cli-annotator
  package.json vite.config.js eslint.config.js index.html README.md CLAUDE.md
  src/main.jsx src/App.jsx src/App.css src/files.js src/lastBundle.js src/browser.test.js
  src/components/  InputsBar.jsx DumpView.jsx LineDetail.jsx SummaryPanel.jsx ExportBar.jsx
  src/lib/         bundle.js parseConfig.js syntax.js interfaces.js resolveViews.js matchLines.js
                   buildInstances.js redact.js annotate.js (+ *.test.js)
  src/lib/export/  json.js text.js html.js (+ *.test.js)
  test/fixtures/   bundle-v2.json device-excerpt.txt
  scripts/check-dumps.mjs scripts/check-dumps.test.mjs
```

Data flow: `annotate(text, bundle, {equivalence, redact})` →
`loadBundle` → `parseConfig` → `redactLines` → `resolveViews` → `matchLines` → `buildInstances` → result.
Exports take the result.

### Task 1: ontology-ui bundle format v2 (`viewIndex`)

Repo: `/mnt/c/code/ontology-ui`, branch `cli-tracing` (check with `git -C /mnt/c/code/ontology-ui branch --show-current`).

**Files:**
- Modify: `server/cliViewFamilies.js` (add `allViewPaths` after `resolveViewPath`)
- Modify: `server/cli.js:6` (import) and after `getViewPath` (~line 212)
- Modify: `server/index.js` (route after `/api/cli/view-path/:packageId`, ~line 207)
- Modify: `src/utils/cliCatalogueApi.js` (after `getViewPath`, ~line 113)
- Modify: `src/utils/topoCliBundle.js`
- Modify: `src/components/CLIPage.jsx:504-525` (`handleAnnotationBundle`)
- Modify: `docs/topo-cli-bundle.md`
- Test: `server/cliViewFamilies.test.js`, `src/utils/topoCliBundle.test.js`

**Interfaces:**
- Consumes: `resolveViewPath(pkg, viewName, viewParentMap)` → `[{view, entryCommand, params}]` (starts at `user view`).
- Produces (the bundle contract every later task reads):
  - `formatVersion: 2`
  - `viewIndex: { [viewName]: { entryCommand: string|null, params: string[], parentView: string|null, enteredBy?: string[] } }`
  - `parentView` is the previous step of the view's path, or `null` when that step is `user view` (so `system view` has `parentView: null`).
  - `enteredBy` lists featureIds of bundle commands whose `enableViews` include the view.

- [ ] **Step 1: Write the failing `allViewPaths` test**

Append to `server/cliViewFamilies.test.js`, and add `allViewPaths` to its import on line 3:

```js
test('allViewPaths resolves a path for every view in the package', () => {
  const pkg = {
    views: { 'system view': [], 'bgp view': ['f1'] },
    viewEntryIndex: {
      'bgp view': [{ featureId: 'f1', title: 'BGP', clis: ['bgp <as-number>'], parentView: ['system view'] }],
    },
  };
  const paths = allViewPaths(pkg, { 'system view': ['user view'], 'bgp view': ['system view'] });
  assert.deepEqual(Object.keys(paths), ['system view', 'bgp view']);
  assert.deepEqual(
    paths['bgp view'].map(s => [s.view, s.entryCommand]),
    [['user view', null], ['system view', 'system-view'], ['bgp view', 'bgp <as-number>']],
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/ontology-ui && node --test server/cliViewFamilies.test.js`
Expected: FAIL — `allViewPaths` is not exported.

- [ ] **Step 3: Implement `allViewPaths`, `getAllViewPaths`, the route and the client**

In `server/cliViewFamilies.js`, after `resolveViewPath`:

```js
/** Navigation path for every view in the package: { viewName: [{view, entryCommand, params}] }. */
export function allViewPaths(pkg, viewParentMap) {
  const out = {};
  for (const v of Object.keys(pkg.views ?? {})) out[v] = resolveViewPath(pkg, v, viewParentMap);
  return out;
}
```

In `server/cli.js`, change line 6 to
`import { computeViewFamilies, resolveViewPath, allViewPaths } from './cliViewFamilies.js';`
and add after `getViewPath`:

```js
/**
 * Navigation paths for every view of a package (for the annotation bundle's viewIndex).
 * Returns { status: 'ready'|'building', paths } or null if the package is not found.
 */
export function getAllViewPaths(pkgId) {
  const pkg = _packages.get(pkgId);
  if (!pkg) return null;
  if (!pkg.viewParentMap) return { status: 'building', paths: null };
  return { status: 'ready', paths: allViewPaths(pkg, pkg.viewParentMap) };
}
```

In `server/index.js`, after the `/api/cli/view-path/:packageId` route:

```js
// Navigation paths for every view of a package
app.get('/api/cli/view-paths/:packageId', (req, res) => {
  const data = cli.getAllViewPaths(req.params.packageId);
  if (!data) return res.status(404).json({ error: 'package not found' });
  res.json(data);
});
```

In `src/utils/cliCatalogueApi.js`, after `getViewPath`:

```js
/**
 * Navigation paths for every view of a package.
 * Returns { status: 'ready'|'building', paths: {viewName: [{view, entryCommand, params}]} | null }
 * or null on error.
 */
export async function getAllViewPaths(packageId) {
  try {
    const res = await fetch(`${BASE}/view-paths/${encodeURIComponent(packageId)}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/ontology-ui && node --test server/cliViewFamilies.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Write the failing `viewIndex` tests**

In `src/utils/topoCliBundle.test.js`, change `assert.equal(b.formatVersion, 1);` to `assert.equal(b.formatVersion, 2);` and append:

```js
const allViewPaths = {
  'system view': [{ view: 'user view', entryCommand: null, params: [] },
                  { view: 'system view', entryCommand: 'system-view', params: [] }],
  'ge sub-interface view': [{ view: 'user view', entryCommand: null, params: [] },
                            { view: 'system view', entryCommand: 'system-view', params: [] },
                            { view: 'ge sub-interface view', entryCommand: 'interface GigabitEthernet <interface-number>.<sub-number>',
                              params: ['interface-number', 'sub-number'] }],
  'is-is view': [{ view: 'user view', entryCommand: null, params: [] },
                 { view: 'system view', entryCommand: 'system-view', params: [] },
                 { view: 'is-is view', entryCommand: null, params: [] }],
};

test('viewIndex has every catalogue view with its entry command, parent and entering commands', () => {
  const b = buildAnnotationBundle({ ...input, allViewPaths });
  assert.deepEqual(b.viewIndex['ge sub-interface view'], {
    entryCommand: 'interface GigabitEthernet <interface-number>.<sub-number>',
    params: ['interface-number', 'sub-number'], parentView: 'system view',
  });
  assert.equal(b.viewIndex['system view'].parentView, null);
  assert.deepEqual(b.viewIndex['is-is view'], { entryCommand: null, params: [], parentView: 'system view', enteredBy: ['abc'] });
});

test('viewIndex is empty without allViewPaths', () => {
  assert.deepEqual(buildAnnotationBundle(input).viewIndex, {});
});
```

- [ ] **Step 6: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/ontology-ui && node --test src/utils/topoCliBundle.test.js`
Expected: FAIL — `formatVersion` is 1 and `viewIndex` is undefined.

- [ ] **Step 7: Implement `buildViewIndex`**

In `src/utils/topoCliBundle.js`, add after `commandEntry`:

```js
// Every catalogue view → the line that opens it, its parent view and the mapped
// commands that enter it (enableViews). Lets an annotator place blocks whose view
// no mapping uses, e.g. GigabitEthernet interfaces when mappings were made on 100GE.
function buildViewIndex(allViewPaths, commandMap) {
  const index = {};
  for (const [view, path] of Object.entries(allViewPaths ?? {})) {
    const last = path?.[path.length - 1];
    const prev = path?.[path.length - 2];
    index[view] = {
      entryCommand: last?.entryCommand ?? null,
      params:       last?.params ?? [],
      parentView:   prev && prev.view !== 'user view' ? prev.view : null,
    };
  }
  for (const [fid, c] of Object.entries(commandMap)) {
    for (const v of c.enableViews) {
      if (!index[v]) continue;
      (index[v].enteredBy ??= []).push(fid);
      index[v].parentView ??= c.parentViews[0] ?? null;
    }
  }
  return index;
}
```

Add `allViewPaths` to the destructured parameters of `buildAnnotationBundle` (after `viewPaths`), change the comment above it to
`// commands: catalogue command objects; viewPaths: { viewName: [{view, entryCommand, params}] } for the mapped views; allViewPaths: the same for every catalogue view.`,
set `formatVersion: 2`, and add `viewIndex: buildViewIndex(allViewPaths, commandMap),` after `views,` in the returned object.

- [ ] **Step 8: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/ontology-ui && timeout 300 node --test server/cliViewFamilies.test.js src/utils/topoCliBundle.test.js`
Expected: PASS.

- [ ] **Step 9: Fetch all view paths in `handleAnnotationBundle`**

In `src/components/CLIPage.jsx`, replace the `Promise.all` through the `buildAnnotationBundle` call with:

```js
      const [commandBatches, paths, all] = await Promise.all([
        Promise.all(batches),
        Promise.all(views.map(v => cliApi.getViewPath(packageId, v))),
        cliApi.getAllViewPaths(packageId),
      ]);
      if (!all) throw new Error('Could not read the CLI catalogue view paths.');
      if (all.status !== 'ready') throw new Error('The CLI catalogue is still indexing views; try the annotation bundle again in a moment.');
      const viewPaths = {};
      paths.forEach((p, i) => { if (p?.path) viewPaths[views[i]] = p.path; });
      const bundle = buildAnnotationBundle({ ...topoInputs(), commands: commandBatches.flat(), viewPaths, allViewPaths: all.paths });
```

Check how `cliApi` is imported at the top of the file (`import * as cliApi …`); `getAllViewPaths` needs no import change if it is a namespace import. If it is a named import list, add `getAllViewPaths` to it and call it without the `cliApi.` prefix.

- [ ] **Step 10: Update `docs/topo-cli-bundle.md`**

- Change the heading `## Shape (\`formatVersion: 1\`)` to `## Shape (\`formatVersion: 2\`)` and `"formatVersion": 1,` to `"formatVersion": 2,`.
- After the closing `},` of the `"views"` block, add:

```jsonc
  // Every catalogue view (not only the mapped ones): the line that opens it, its parent view, and
  // the mapped commands that enter it (their enableViews). parentView null means system view.
  "viewIndex": {
    "ge sub-interface view": { "entryCommand": "interface GigabitEthernet <interface-number>.<sub-number>",
                               "params": ["interface-number", "sub-number"], "parentView": "system view" },
    "is-is view": { "entryCommand": null, "params": [], "parentView": "system view", "enteredBy": ["6b485d79…"] }
  },
```

- In "Annotating a configuration dump", step 1, replace `` `views[*].path[-1].entryCommand` `` with
  `` `viewIndex[*].entryCommand`, or a command in `viewIndex[*].enteredBy` ``.
- Add a final paragraph: `Format v1 bundles have no \`viewIndex\`; use \`views[*].path\`, which covers only the mapped views.`

- [ ] **Step 11: Check the route against the dev server (optional, no deploy)**

Run the API server in the background (`npm run server:dev`), then
`curl -s localhost:3001/api/cli/packages | head -c 300` to find a package id, and
`curl -s localhost:3001/api/cli/view-paths/<id> | head -c 300`.
Expected: `{"status":"ready","paths":{…` (or `"building"` for a few seconds after start). Stop the server afterwards.

- [ ] **Step 12: Lint and commit**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/ontology-ui && npm run lint
git -C /mnt/c/code/ontology-ui add server/cliViewFamilies.js server/cliViewFamilies.test.js server/cli.js server/index.js \
  src/utils/cliCatalogueApi.js src/utils/topoCliBundle.js src/utils/topoCliBundle.test.js src/components/CLIPage.jsx docs/topo-cli-bundle.md
git -C /mnt/c/code/ontology-ui commit -m "CLI annotation bundle v2: viewIndex of every catalogue view" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 2: Scaffold, fixture bundle and `loadBundle`

Repo: `/mnt/c/code/cli-annotator` (`main`, one commit: the spec).

**Files:**
- Create: `package.json`, `vite.config.js`, `eslint.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx` (a stub Task 12 replaces), `src/App.css` (empty; Task 12 fills it)
- Create: `test/fixtures/bundle-v2.json`
- Create: `src/lib/bundle.js`, `src/lib/bundle.test.js`

**Interfaces:**
- Produces: `loadBundle(input: string|object) → Loaded`, where
  `Loaded = {formatVersion, device: {name, softwareVersion}, generatedAt, mappings[], commands: {fid: {title, syntax[], parentViews[], enableViews[], parameters[{name, description}], examples[]}}, viewIndex: {view: {entryCommand, params[], parentView, enteredBy?[]}}, dteEntities, gaps, commandMappings: mapping[], viewMappings: {view: mapping[]}, warnings: string[]}`.
  - `commandMappings`: mappings with `sourceType === 'command'` whose command has catalogue syntax.
  - `viewMappings`: `view` and `view-family` mappings, keyed by `m.view`.
  - A mapping is `{id, sourceType, featureId, title, view, viewFamily, cliParameter, isKey, keyHint, dte: {id, entity, field}, relation, topology[]}` (other bundle fields are carried but unused).
- Produces: `BUNDLE_FORMAT = 'ontology-ui.topo-cli-annotation-bundle'`.
- Produces: `test/fixtures/bundle-v2.json`, used by Tasks 6–13.

- [ ] **Step 1: Write the project files**

`package.json`:

```json
{
  "name": "cli-annotator",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "node --test src/lib/",
    "check-dumps": "node scripts/check-dumps.mjs"
  },
  "dependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^10.3.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.6.0",
    "vite": "^8.0.12"
  }
}
```

`vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);

// The built page may not talk to any server: dumps hold secrets and never leave the browser.
const CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

const cspMeta = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), cspMeta],
  server: {
    // Watching on an NTFS mount is unreliable under WSL2.
    ...(isWsl ? { watch: null } : {}),
  },
})
```

`eslint.config.js`:

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['**/*.test.js', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CLI Annotator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

`src/main.jsx`:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.jsx` (replaced in Task 12):

```jsx
export default function App() {
  return <main className="app">CLI Annotator</main>;
}
```

`src/App.css`: an empty file.

- [ ] **Step 2: Install and build**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && npm install && npm run build && grep -c "connect-src 'none'" dist/index.html`
Expected: install and build succeed; the grep prints `1`.

- [ ] **Step 3: Write the fixture bundle**

`test/fixtures/bundle-v2.json` — a trimmed, hand-made v2 bundle (no device data). Every later task's expectations depend on it exactly:

```json
{
  "format": "ontology-ui.topo-cli-annotation-bundle",
  "formatVersion": 2,
  "generatedAt": "2026-10-21T09:00:00.000Z",
  "device": { "name": "NE8000", "softwareVersion": "V800R022C00SPC600" },
  "mappings": [
    { "id": "m-isis", "sourceType": "command", "featureId": "f-isis", "title": "isis", "view": "system view", "viewFamily": null,
      "cliParameter": "process-id", "isKey": true, "keyHint": null,
      "dte": { "id": "Twin_IGP", "entity": "IGP", "field": "igpId" }, "relation": "configures", "topology": ["isisprocess"] },
    { "id": "m-net", "sourceType": "command", "featureId": "f-net", "title": "network-entity", "view": "is-is view", "viewFamily": null,
      "cliParameter": "net-addr", "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_IGP", "entity": "IGP", "field": "networkEntityId" }, "relation": "configures", "topology": ["isisprocess"] },
    { "id": "m-isisen", "sourceType": "command", "featureId": "f-isisen", "title": "isis enable", "view": "100ge interface view", "viewFamily": null,
      "cliParameter": null, "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_FixedNetworkLTP", "entity": "FixedNetworkLTP", "field": null }, "relation": "enables",
      "topology": ["ethernetport", "vlaninterface", "ipv4interface", "isisinterface", "vpwssap", "l3vpnsap"] },
    { "id": "m-ip", "sourceType": "command", "featureId": "f-ipaddr", "title": "ip address", "view": "100ge interface view", "viewFamily": null,
      "cliParameter": "ip-address", "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_FixedNetworkLTP", "entity": "FixedNetworkLTP", "field": "IP__addrv4" }, "relation": "configures",
      "topology": ["ethernetport", "vlaninterface", "ipv4interface", "isisinterface", "vpwssap", "l3vpnsap"] },
    { "id": "m-vlan", "sourceType": "command", "featureId": "f-vlan", "title": "vlan-type dot1q", "view": "100ge sub-interface view", "viewFamily": null,
      "cliParameter": "vlan-id", "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_FixedNetworkLTP", "entity": "FixedNetworkLTP", "field": "Eth__vlan" }, "relation": "configures",
      "topology": ["ethernetport", "vlaninterface", "ipv4interface", "isisinterface", "vpwssap", "l3vpnsap"] },
    { "id": "m-bind", "sourceType": "command", "featureId": "f-bind", "title": "ip binding vpn-instance", "view": "100ge interface view", "viewFamily": null,
      "cliParameter": "vpn-instance-name", "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_VRF", "entity": "VRF", "field": "vrfName" }, "relation": "references", "topology": ["l3vpninstance"] },
    { "id": "m-l2vc", "sourceType": "command", "featureId": "f-l2vc", "title": "mpls l2vc", "view": "100ge sub-interface view", "viewFamily": null,
      "cliParameter": "vc-id", "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_PW", "entity": "PW", "field": "pwId" }, "relation": "configures", "topology": ["pw"] },
    { "id": "m-rd", "sourceType": "command", "featureId": "f-rd", "title": "route-distinguisher", "view": "vpn instance view", "viewFamily": null,
      "cliParameter": "route-distinguisher", "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_VRF", "entity": "VRF", "field": "rd" }, "relation": "configures", "topology": ["l3vpninstance"] },
    { "id": "m-rt", "sourceType": "command", "featureId": "f-rt", "title": "vpn-target", "view": "vpn instance view", "viewFamily": null,
      "cliParameter": "vpn-target", "isKey": false, "keyHint": null,
      "dte": { "id": "Twin_VRF", "entity": "VRF", "field": "rt" }, "relation": "configures", "topology": ["l3vpninstance"] },
    { "id": "m-ltp", "sourceType": "view", "featureId": null, "title": "100ge interface view", "view": "100ge interface view", "viewFamily": null,
      "cliParameter": null, "isKey": true, "keyHint": "interface 100GE <interface-number>",
      "dte": { "id": "Twin_LTP", "entity": "LTP", "field": "name" }, "relation": "identifies", "topology": ["ethernetport"] },
    { "id": "m-ltp-sub", "sourceType": "view", "featureId": null, "title": "100ge sub-interface view", "view": "100ge sub-interface view", "viewFamily": null,
      "cliParameter": null, "isKey": true, "keyHint": "interface 100GE <interface-number>.<sub-number>",
      "dte": { "id": "Twin_LTP", "entity": "LTP", "field": "name" }, "relation": "identifies", "topology": ["ethernetport"] },
    { "id": "m-vrf", "sourceType": "view", "featureId": null, "title": "vpn instance view", "view": "vpn instance view", "viewFamily": null,
      "cliParameter": "vpn-instance-name", "isKey": true, "keyHint": "ip vpn-instance <vpn-instance-name>",
      "dte": { "id": "Twin_VRF", "entity": "VRF", "field": "vrfName" }, "relation": "identifies", "topology": ["l3vpninstance"] }
  ],
  "commands": {
    "f-isis": { "title": "isis", "syntax": ["isis <process-id> [ vpn-instance <vpn-instance-name> ]", "undo isis <process-id>"],
      "parentViews": ["system view"], "enableViews": ["is-is view"],
      "parameters": [{ "name": "process-id", "description": "IS-IS process ID." }], "examples": ["isis 1"] },
    "f-net": { "title": "network-entity", "syntax": ["network-entity <net-addr>", "undo network-entity <net-addr>"],
      "parentViews": ["is-is view"], "enableViews": [],
      "parameters": [{ "name": "net-addr", "description": "Network entity title." }], "examples": [] },
    "f-isisen": { "title": "isis enable", "syntax": ["isis enable [ <process-id> ]", "undo isis enable"],
      "parentViews": ["100ge interface view", "100ge sub-interface view"], "enableViews": [],
      "parameters": [{ "name": "process-id", "description": "IS-IS process ID." }], "examples": [] },
    "f-ipaddr": { "title": "ip address", "syntax": ["ip address <ip-address> { <mask> | <mask-length> } [ sub ]", "undo ip address"],
      "parentViews": ["ge interface view", "100ge interface view", "loopback interface view"], "enableViews": [],
      "parameters": [{ "name": "ip-address", "description": "IPv4 address." }, { "name": "mask", "description": "Mask." }], "examples": [] },
    "f-vlan": { "title": "vlan-type dot1q", "syntax": ["vlan-type dot1q <vlan-id>", "undo vlan-type dot1q"],
      "parentViews": ["100ge sub-interface view"], "enableViews": [],
      "parameters": [{ "name": "vlan-id", "description": "VLAN ID." }], "examples": [] },
    "f-bind": { "title": "ip binding vpn-instance", "syntax": ["ip binding vpn-instance <vpn-instance-name>", "undo ip binding vpn-instance <vpn-instance-name>"],
      "parentViews": ["ge interface view", "100ge interface view"], "enableViews": [],
      "parameters": [{ "name": "vpn-instance-name", "description": "VPN instance name." }], "examples": [] },
    "f-l2vc": { "title": "mpls l2vc", "syntax": [
        "mpls l2vc <ip-address> <vc-id> [ tunnel-policy <policy-name> ] [ control-word | no-control-word ] [ raw | tagged ]",
        "mpls l2vc instance-name <instance-name> <ip-address> <vc-id> [ control-word | no-control-word ] [ raw | tagged ]",
        "undo mpls l2vc"],
      "parentViews": ["ge sub-interface view", "100ge sub-interface view"], "enableViews": [],
      "parameters": [{ "name": "vc-id", "description": "VC ID." }], "examples": [] },
    "f-rd": { "title": "route-distinguisher", "syntax": ["route-distinguisher <route-distinguisher>"],
      "parentViews": ["vpn instance view"], "enableViews": [],
      "parameters": [{ "name": "route-distinguisher", "description": "RD." }], "examples": [] },
    "f-rt": { "title": "vpn-target", "syntax": ["vpn-target <vpn-target> &<1-8> [ both | export-extcommunity | import-extcommunity ]"],
      "parentViews": ["vpn instance view"], "enableViews": [],
      "parameters": [{ "name": "vpn-target", "description": "VPN target." }], "examples": [] }
  },
  "views": {
    "system view": { "path": [
      { "view": "user view", "entryCommand": null, "params": [] },
      { "view": "system view", "entryCommand": "system-view", "params": [] } ] },
    "is-is view": { "path": [
      { "view": "user view", "entryCommand": null, "params": [] },
      { "view": "system view", "entryCommand": "system-view", "params": [] },
      { "view": "is-is view", "entryCommand": null, "params": [] } ] },
    "100ge interface view": { "path": [
      { "view": "user view", "entryCommand": null, "params": [] },
      { "view": "system view", "entryCommand": "system-view", "params": [] },
      { "view": "100ge interface view", "entryCommand": "interface 100GE <interface-number>", "params": ["interface-number"] } ] },
    "100ge sub-interface view": { "path": [
      { "view": "user view", "entryCommand": null, "params": [] },
      { "view": "system view", "entryCommand": "system-view", "params": [] },
      { "view": "100ge sub-interface view", "entryCommand": "interface 100GE <interface-number>.<sub-number>", "params": ["interface-number", "sub-number"] } ] },
    "vpn instance view": { "path": [
      { "view": "user view", "entryCommand": null, "params": [] },
      { "view": "system view", "entryCommand": "system-view", "params": [] },
      { "view": "vpn instance view", "entryCommand": "ip vpn-instance <vpn-instance-name>", "params": ["vpn-instance-name"] } ] }
  },
  "viewIndex": {
    "system view": { "entryCommand": "system-view", "params": [], "parentView": null },
    "ge interface view": { "entryCommand": "interface GigabitEthernet <interface-number>", "params": ["interface-number"], "parentView": "system view" },
    "ge sub-interface view": { "entryCommand": "interface GigabitEthernet <interface-number>.<sub-number>", "params": ["interface-number", "sub-number"], "parentView": "system view" },
    "100ge interface view": { "entryCommand": "interface 100GE <interface-number>", "params": ["interface-number"], "parentView": "system view" },
    "100ge sub-interface view": { "entryCommand": "interface 100GE <interface-number>.<sub-number>", "params": ["interface-number", "sub-number"], "parentView": "system view" },
    "loopback interface view": { "entryCommand": "interface LoopBack <loopback-number>", "params": ["loopback-number"], "parentView": "system view" },
    "vpn instance view": { "entryCommand": "ip vpn-instance <vpn-instance-name>", "params": ["vpn-instance-name"], "parentView": "system view" },
    "vpn instance ipv4 address family view": { "entryCommand": "ipv4-family", "params": [], "parentView": "vpn instance view" },
    "is-is view": { "entryCommand": null, "params": [], "parentView": "system view", "enteredBy": ["f-isis"] }
  },
  "dteEntities": {
    "Twin_IGP": { "logicalName": "IGP", "topology": [
      { "entity": "isisprocess", "schema": "igplayer-specific-isis", "type": "node", "attributes": ["igpId"], "via": ["schema"] } ] },
    "Twin_FixedNetworkLTP": { "logicalName": "FixedNetworkLTP", "topology": [
      { "entity": "ethernetport", "schema": "layer2-specific-ethernet", "type": "tp", "attributes": ["name"], "via": ["schema"] },
      { "entity": "vlaninterface", "schema": "layer2-specific-ethernet", "type": "tp", "attributes": ["name"], "via": ["schema"] },
      { "entity": "ipv4interface", "schema": "layer3-specific-ipv4", "type": "tp", "attributes": ["name"], "via": ["schema"] },
      { "entity": "isisinterface", "schema": "igplayer-specific-isis", "type": "tp", "attributes": ["name"], "via": ["schema"] },
      { "entity": "vpwssap", "schema": "servicelayer-specific-l2vpnvpws", "type": "tp", "attributes": ["name"], "via": ["schema"] },
      { "entity": "l3vpnsap", "schema": "servicelayer-specific-l3vpn", "type": "tp", "attributes": ["name"], "via": ["schema"] } ] },
    "Twin_LTP": { "logicalName": "LTP", "topology": [
      { "entity": "ethernetport", "schema": "layer2-specific-ethernet", "type": "tp", "attributes": ["name"], "via": ["schema"] } ] },
    "Twin_VRF": { "logicalName": "VRF", "topology": [
      { "entity": "l3vpninstance", "schema": "servicelayer-specific-l3vpn", "type": "network", "attributes": ["vrfName"], "via": ["schema"] } ] },
    "Twin_PW": { "logicalName": "PW", "topology": [
      { "entity": "pw", "schema": "servicelayer-specific-l2vpnvpws", "type": "link", "attributes": ["pwId"], "via": ["schema"] } ] }
  },
  "gaps": {
    "topologyWithoutDte": [{ "entity": "srv6locator", "schema": "srv6-specific", "type": "tp" }],
    "dteNotFound": [],
    "dteWithoutCli": [{ "dteId": "Twin_NE", "logicalName": "NE", "topology": ["isisnode"] }],
    "userDefined": [],
    "missingCatalogue": { "commands": [], "views": [] }
  }
}
```

- [ ] **Step 4: Write the failing `loadBundle` tests**

`src/lib/bundle.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(raw);

test('loads a v2 bundle and splits command and view mappings', () => {
  const b = loadBundle(raw);
  assert.equal(b.formatVersion, 2);
  assert.deepEqual(b.device, { name: 'NE8000', softwareVersion: 'V800R022C00SPC600' });
  assert.equal(b.commandMappings.length, 9);
  assert.deepEqual(b.viewMappings['100ge interface view'].map(m => m.id), ['m-ltp']);
  assert.deepEqual(b.viewIndex['is-is view'].enteredBy, ['f-isis']);
  assert.deepEqual(b.warnings, []);
});

test('accepts an object and does not mutate its viewIndex', () => {
  const f = fixture();
  const b = loadBundle(f);
  b.viewIndex['is-is view'].enteredBy.push('x');
  assert.deepEqual(f.viewIndex['is-is view'].enteredBy, ['f-isis']);
});

test('rejects invalid JSON, a wrong format and an unknown version with a readable message', () => {
  assert.throws(() => loadBundle('{nope'), /Bundle is not valid JSON/);
  assert.throws(() => loadBundle({ format: 'x' }), /Not an annotation bundle: expected format "ontology-ui.topo-cli-annotation-bundle", got "x"/);
  assert.throws(() => loadBundle({ ...fixture(), formatVersion: 3 }), /Unsupported bundle formatVersion 3/);
});

test('a v1 bundle gets a view index from its view paths and the commands that enter views', () => {
  const f = fixture();
  delete f.viewIndex;
  f.formatVersion = 1;
  const b = loadBundle(f);
  assert.deepEqual(b.viewIndex['100ge interface view'],
    { entryCommand: 'interface 100GE <interface-number>', params: ['interface-number'], parentView: 'system view' });
  assert.equal(b.viewIndex['system view'].parentView, null);
  assert.deepEqual(b.viewIndex['is-is view'].enteredBy, ['f-isis']);
  assert.equal(b.viewIndex['ge interface view'], undefined);
  assert.match(b.warnings[0], /Bundle format v1 has no view index/);
});

test('a command mapping without catalogue syntax is left out and named in a warning', () => {
  const f = fixture();
  delete f.commands['f-net'];
  const b = loadBundle(f);
  assert.equal(b.commandMappings.some(m => m.id === 'm-net'), false);
  assert.match(b.warnings[0], /No catalogue syntax for 1 mapped command\(s\), so they are never matched: network-entity/);
});
```

- [ ] **Step 5: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/bundle.test.js`
Expected: FAIL — cannot find module `./bundle.js`.

- [ ] **Step 6: Implement `src/lib/bundle.js`**

```js
// Loads an ontology-ui annotation bundle (docs/topo-cli-bundle.md in ontology-ui)
// and builds the lookups the annotator needs. Only an unreadable bundle throws.
export const BUNDLE_FORMAT = 'ontology-ui.topo-cli-annotation-bundle';

// v1 bundles carry paths for the mapped views only; derive the same shape as v2's viewIndex.
function viewIndexFromPaths(views) {
  const index = {};
  for (const [view, entry] of Object.entries(views ?? {})) {
    const path = entry?.path ?? [];
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    index[view] = {
      entryCommand: last?.entryCommand ?? null,
      params:       last?.params ?? [],
      parentView:   prev && prev.view !== 'user view' ? prev.view : null,
    };
  }
  return index;
}

function addEnteredBy(index, commands) {
  for (const [fid, c] of Object.entries(commands)) {
    for (const v of c.enableViews ?? []) {
      index[v] ??= { entryCommand: null, params: [], parentView: c.parentViews?.[0] ?? null };
      const entered = (index[v].enteredBy ??= []);
      if (!entered.includes(fid)) entered.push(fid);
    }
  }
}

export function loadBundle(input) {
  let b = input;
  if (typeof input === 'string') {
    try { b = JSON.parse(input); } catch (e) { throw new Error(`Bundle is not valid JSON: ${e.message}`); }
  }
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) {
    throw new Error(`Not an annotation bundle: expected format "${BUNDLE_FORMAT}", got "${b?.format ?? typeof b}".`);
  }
  if (b.formatVersion !== 1 && b.formatVersion !== 2) {
    throw new Error(`Unsupported bundle formatVersion ${b.formatVersion}; this annotator reads versions 1 and 2.`);
  }

  const warnings = [];
  const commands = b.commands ?? {};
  let viewIndex;
  if (b.formatVersion === 2 && b.viewIndex) {
    viewIndex = structuredClone(b.viewIndex);
  } else {
    viewIndex = viewIndexFromPaths(b.views);
    addEnteredBy(viewIndex, commands);
    warnings.push('Bundle format v1 has no view index: interface equivalence is limited to the views the mappings use. Export the bundle again from ontology-ui for full coverage.');
  }

  const mappings = b.mappings ?? [];
  const commandMappings = [];
  const viewMappings = {};
  const noSyntax = [];
  const noView = [];
  for (const m of mappings) {
    if (m.sourceType === 'command') {
      if (commands[m.featureId]?.syntax?.length) commandMappings.push(m);
      else noSyntax.push(m.title || m.featureId);
    } else if (m.view) {
      (viewMappings[m.view] ??= []).push(m);
    } else {
      noView.push(m.title || m.id);
    }
  }
  if (noSyntax.length) {
    warnings.push(`No catalogue syntax for ${noSyntax.length} mapped command(s), so they are never matched: ${[...new Set(noSyntax)].join(', ')}.`);
  }
  if (noView.length) warnings.push(`${noView.length} view mapping(s) name no view and are not used: ${noView.join(', ')}.`);

  return {
    formatVersion: b.formatVersion,
    device:        b.device ?? {},
    generatedAt:   b.generatedAt ?? null,
    mappings, commands, viewIndex,
    dteEntities:   b.dteEntities ?? {},
    gaps:          b.gaps ?? {},
    commandMappings, viewMappings, warnings,
  };
}
```

- [ ] **Step 7: Run the tests and lint**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && npm test && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 8: Commit**

```bash
git -C /mnt/c/code/cli-annotator add package.json package-lock.json vite.config.js eslint.config.js index.html src test
git -C /mnt/c/code/cli-annotator commit -m "Scaffold the annotator and load annotation bundles" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 3: `parseConfig` and the dump excerpt fixture

**Files:**
- Create: `test/fixtures/device-excerpt.txt`
- Create: `src/lib/parseConfig.js`, `src/lib/parseConfig.test.js`

**Interfaces:**
- Produces: `parseConfig(text: string) → {softwareVersion: string|null, sysname: string|null, lines: Line[], blocks: Block[]}`
  - `Line = {n (1-based), text (raw, no line ending), indent, kind: 'config'|'blank'|'header'|'separator'|'end', block: blockId|null, opens: blockId|null}`. `block` is the block the line sits in; `opens` the block it opens.
  - `Block = {id (index into blocks), opener: n, text (opener, trimmed), parent: blockId|null, depth, children: n[]}`.
  - Every top-level config line opens a block (most have no children). A deeper config line turns the config line before it into an opener.
- Produces: `test/fixtures/device-excerpt.txt`, used by Tasks 6–13.

- [ ] **Step 1: Write the excerpt fixture**

`test/fixtures/device-excerpt.txt` — hand-made in the style of `device_207`, secret-free (the cipher is fake). Exactly 33 lines, LF endings, a final newline:

```
!Software Version V800R025C10SPC500
!Last configuration was updated at 2026-10-01 10:00:00+00:00
#
sysname PE207
#
ip vpn-instance L3VPN_A
 ipv4-family
  route-distinguisher 100:1
  vpn-target 100:1 export-extcommunity
  vpn-target 100:1 import-extcommunity
#
aaa
 local-user admin password irreversible-cipher $1c$FAKESECRETFAKE$
#
isis 207
 is-level level-2
 network-entity 49.0001.0010.0100.1207.00
#
interface GigabitEthernet0/2/1
 undo shutdown
 ip binding vpn-instance L3VPN_A
 ip address 10.0.0.1 255.255.255.0
 isis enable 207
#
interface GigabitEthernet0/2/1.111
 vlan-type dot1q 111
 mtu 1500
 mpls l2vc instance-name GigabitEthernet0/2/1.111 192.0.2.9 7 no-control-word raw
#
interface LoopBack0
 ip address 1.1.1.207 255.255.255.255
#
return
```

Check: `wc -l /mnt/c/code/cli-annotator/test/fixtures/device-excerpt.txt` prints `33`.

- [ ] **Step 2: Write the failing tests**

`src/lib/parseConfig.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from './parseConfig.js';

const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const line = (p, n) => p.lines[n - 1];
const blockOf = (p, n) => p.blocks[line(p, n).block];

test('reads the header and sysname and numbers every line', () => {
  const p = parseConfig(excerpt);
  assert.equal(p.softwareVersion, 'V800R025C10SPC500');
  assert.equal(p.sysname, 'PE207');
  assert.equal(p.lines.length, 33);
  assert.deepEqual([1, 2, 3, 33].map(n => line(p, n).kind), ['header', 'header', 'separator', 'end']);
  assert.equal(p.lines.filter(l => l.kind === 'config').length, 22);
});

test('top-level lines open blocks and indentation nests them', () => {
  const p = parseConfig(excerpt);
  const vpn = p.blocks[line(p, 6).opens];
  const fam = p.blocks[line(p, 7).opens];
  assert.equal(vpn.text, 'ip vpn-instance L3VPN_A');
  assert.equal(vpn.parent, null);
  assert.equal(fam.parent, vpn.id);
  assert.equal(fam.depth, 1);
  assert.deepEqual(fam.children, [8, 9, 10]);
  assert.deepEqual(vpn.children, [7]);
  assert.equal(line(p, 7).block, vpn.id);
  assert.equal(blockOf(p, 23).text, 'interface GigabitEthernet0/2/1');
  assert.equal(line(p, 4).opens !== null, true);
  assert.deepEqual(p.blocks[line(p, 4).opens].children, []);
});

test('a lone # at child depth closes the sub-block', () => {
  const p = parseConfig('bgp 100\n ipv4-family unicast\n  undo synchronization\n #\n peer 1.1.1.1 enable\n#\n');
  assert.equal(p.blocks.length, 2);
  assert.equal(line(p, 4).kind, 'separator');
  assert.equal(line(p, 5).block, line(p, 1).opens);
  assert.equal(line(p, 5).opens, null);
});

test('a dump saved with CRLF endings and a BOM parses like the LF original', () => {
  const lf = parseConfig(excerpt);
  const crlf = parseConfig('﻿' + excerpt.replace(/\n/g, '\r\n'));
  assert.equal(crlf.softwareVersion, 'V800R025C10SPC500');
  assert.equal(crlf.lines.length, 33);
  assert.equal(crlf.lines.some(l => l.text.includes('\r') || l.text.includes('﻿')), false);
  assert.deepEqual(crlf.lines.map(l => [l.kind, l.block, l.opens]), lf.lines.map(l => [l.kind, l.block, l.opens]));
  assert.deepEqual(crlf.blocks, lf.blocks);
});

test('a dump without a header still parses', () => {
  const p = parseConfig('sysname X\n#\nreturn');
  assert.equal(p.softwareVersion, null);
  assert.equal(p.sysname, 'X');
  assert.equal(p.lines.length, 3);
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/parseConfig.test.js`
Expected: FAIL — cannot find module `./parseConfig.js`.

- [ ] **Step 4: Implement `src/lib/parseConfig.js`**

```js
// Splits a `display current-configuration` dump into numbered lines and nested
// blocks. Never throws: anything it cannot place is still a numbered line.
export function parseConfig(text) {
  const raw = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  if (raw.length && raw[raw.length - 1] === '') raw.pop();

  const lines = [];
  const blocks = [];
  let softwareVersion = null;
  let sysname = null;
  let ended = false;
  let stack = [];   // open blocks, innermost last: {id, indent}
  let last = null;  // previous config line, a candidate opener

  const open = (line) => {
    const parent = line.block;
    const block = {
      id: blocks.length, opener: line.n, text: line.text.trim(), parent,
      depth: parent === null ? 0 : blocks[parent].depth + 1, children: [],
    };
    blocks.push(block);
    line.opens = block.id;
    stack.push({ id: block.id, indent: line.indent });
  };

  raw.forEach((t, i) => {
    const body = t.trim();
    const indent = t.length - t.trimStart().length;
    const line = { n: i + 1, text: t, indent, kind: 'config', block: null, opens: null };
    lines.push(line);

    if (ended) { line.kind = 'end'; return; }
    if (!body) { line.kind = 'blank'; return; }
    if (indent === 0 && body.startsWith('!')) {
      line.kind = 'header';
      softwareVersion ??= /^!Software Version (\S+)/.exec(body)?.[1] ?? null;
      return;
    }
    if (body === '#') {
      line.kind = 'separator';
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      last = null;
      return;
    }
    if (indent === 0 && body === 'return') {
      line.kind = 'end';
      ended = true;
      stack = [];
      return;
    }

    if (last && indent > last.indent && last.opens === null) open(last);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    line.block = stack.length ? stack[stack.length - 1].id : null;
    if (line.block !== null) blocks[line.block].children.push(line.n);
    if (indent === 0) {
      open(line);
      sysname ??= /^sysname\s+(\S+)/.exec(body)?.[1] ?? null;
    }
    last = line;
  });

  return { softwareVersion, sysname, lines, blocks };
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/parseConfig.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/parseConfig.js src/lib/parseConfig.test.js test/fixtures/device-excerpt.txt
git -C /mnt/c/code/cli-annotator commit -m "Parse configuration dumps into lines and nested blocks" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 4: Catalogue syntax matcher

**Files:**
- Create: `src/lib/syntax.js`, `src/lib/syntax.test.js`

**Interfaces:**
- Produces: `compileSyntax(syntax: string) → {syntax, ok: boolean, first: string|null, match(line) → {params: {name: value}, literals: number, prefixOnly?: true} | null}`
  - `ok: false` means the notation could not be parsed; `match` then compares the leading keywords only and returns `prefixOnly: true` with empty params.
  - `first` is the lowercased first keyword, or null when the syntax starts with a parameter or bracket.
- Produces: `compileCommand(cmd: {syntax: string[]}) → {forms, match(line) → {params, literals, prefixOnly: boolean, syntax: string} | null}`. It skips `undo …` forms and returns the best form: a full match beats a prefix-only one, then the most literals, then the first form.
- Notation: keywords (case-insensitive whole tokens), `<param>` (one token), composite tokens like `<interface-number>.<sub-number>` (one token, split by the literal pieces), `[ optional ]`, `{ a | b }`, nesting, `[ … ] *` (zero or more), `{ … } *` (one or more), `<x> &<1-n>` (1..n values; the first is captured).
- Joined form: a keyword followed by a parameter also matches one token made of the keyword plus a value starting with a digit (`GigabitEthernet0/2/1`, `LoopBack0`).
- A reading must consume the whole line. Among full readings the one with the most literal keywords wins; on a tie the first found. A parameter that matches twice keeps its first value.
- Budget: `MAX_STEPS = 20000` node visits and `MAX_RESULTS = 1000` readings per `match` call.

- [ ] **Step 1: Write the failing tests**

`src/lib/syntax.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSyntax, compileCommand } from './syntax.js';

test('keywords match case-insensitively as whole tokens; a choice takes the first option on a tie', () => {
  const s = compileSyntax('ip address <ip-address> { <mask> | <mask-length> } [ sub ]');
  assert.equal(s.ok, true);
  assert.equal(s.first, 'ip');
  assert.deepEqual(s.match('IP Address 10.0.0.1 255.255.255.0'),
    { params: { 'ip-address': '10.0.0.1', mask: '255.255.255.0' }, literals: 2 });
  assert.equal(s.match('ip addresses 10.0.0.1 24'), null);
});

test('an optional keyword counts as a literal when present; extra tokens fail the match', () => {
  const s = compileSyntax('ip address <ip-address> { <mask> | <mask-length> } [ sub ]');
  assert.equal(s.match('ip address 1.1.1.1 24 sub').literals, 3);
  assert.equal(s.match('ip address 1.1.1.1 24 sub extra'), null);
});

test('&<1-n> repeats a value up to n times and captures the first', () => {
  const s = compileSyntax('vpn-target <vpn-target> &<1-8> [ both | export-extcommunity | import-extcommunity ]');
  assert.deepEqual(s.match('vpn-target 100:1 200:2 export-extcommunity'),
    { params: { 'vpn-target': '100:1' }, literals: 2 });
  const nine = Array.from({ length: 9 }, (_, k) => `${k}:1`).join(' ');
  assert.equal(s.match(`vpn-target ${nine}`), null);
});

test('[ … ] * allows zero or more, { … } * one or more', () => {
  const opt = compileSyntax('mtu <mtu> [ spread | test ] *');
  assert.deepEqual(opt.match('mtu 1500'), { params: { mtu: '1500' }, literals: 1 });
  assert.equal(opt.match('mtu 1500 test spread').literals, 3);
  assert.equal(opt.match('mtu 1500 foo'), null);
  const req = compileSyntax('x { a | b } *');
  assert.equal(req.match('x'), null);
  assert.equal(req.match('x b a').literals, 3);
});

test('composite tokens split on their literal pieces: lazy groups, greedy last group', () => {
  const s = compileSyntax('x <a>.<b>');
  assert.deepEqual(s.match('x 1.2.3').params, { a: '1', b: '2.3' });
});

test('a keyword and its value may be joined in one token when the value starts with a digit', () => {
  const sub = compileSyntax('interface GigabitEthernet <interface-number>.<sub-number>');
  const want = { 'interface-number': '0/2/1', 'sub-number': '111' };
  assert.deepEqual(sub.match('interface GigabitEthernet0/2/1.111').params, want);
  assert.deepEqual(sub.match('interface GigabitEthernet 0/2/1.111').params, want);
  assert.equal(sub.match('interface GigabitEthernet0/2/1.111').literals, 2);
  const lo = compileSyntax('interface LoopBack <loopback-number>');
  assert.deepEqual(lo.match('interface LoopBack0').params, { 'loopback-number': '0' });
  assert.equal(lo.match('interface LoopBackX'), null);
});

test('notation that cannot be parsed falls back to its leading keywords', () => {
  const s = compileSyntax('foo bar [ <x>');
  assert.equal(s.ok, false);
  assert.deepEqual(s.match('foo bar 1'), { params: {}, literals: 2, prefixOnly: true });
  assert.equal(s.match('foo baz'), null);
});

test('compileCommand skips undo forms and picks the form with the most literals', () => {
  const l2vc = compileCommand({ syntax: [
    'mpls l2vc <ip-address> <vc-id> [ tunnel-policy <policy-name> ] [ control-word | no-control-word ] [ raw | tagged ]',
    'mpls l2vc instance-name <instance-name> <ip-address> <vc-id> [ control-word | no-control-word ] [ raw | tagged ]',
    'undo mpls l2vc',
  ] });
  const r = l2vc.match('mpls l2vc instance-name GigabitEthernet0/2/1.111 192.0.2.9 7 no-control-word raw');
  assert.equal(r.params['vc-id'], '7');
  assert.equal(r.prefixOnly, false);
  assert.match(r.syntax, /instance-name/);
  assert.equal(compileCommand({ syntax: ['undo isis <process-id>'] }).match('undo isis 1'), null);
});

test('compileCommand prefers a full match over a prefix-only one', () => {
  const c = compileCommand({ syntax: ['isis [ broken', 'isis <process-id>'] });
  assert.deepEqual(c.match('isis 7'), { params: { 'process-id': '7' }, literals: 1, prefixOnly: false, syntax: 'isis <process-id>' });
});

test('a pathological starred syntax gives up within the step budget', () => {
  const s = compileSyntax('a [ <p> | <q> | b ] * [ <r> | <s> ] * c');
  const line = 'a' + ' x'.repeat(40) + ' d';
  const t0 = Date.now();
  assert.equal(s.match(line), null);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/syntax.test.js`
Expected: FAIL — cannot find module `./syntax.js`.

- [ ] **Step 3: Implement `src/lib/syntax.js`**

```js
// Matches config lines against CLI catalogue syntax strings, e.g.
// "isis <process-id> [ vpn-instance <vpn-instance-name> ]". Never throws: notation
// it cannot parse degrades to a leading-keyword match flagged prefixOnly.
const MAX_STEPS = 20000;   // node visits per match call
const MAX_RESULTS = 1000;  // readings considered per match call
let steps = 0;

const PARAM_RE = /^<[^<>]+>$/;
const tokenize = s => s.match(/&<\d+-\d+>|[[\]{}|*]|[^\s[\]{}|*]+/g) ?? [];
const lineTokens = line => String(line).trim().split(/\s+/).filter(Boolean);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function leaf(tok) {
  if (PARAM_RE.test(tok)) return { t: 'param', name: tok.slice(1, -1) };
  if (tok.includes('<')) {
    const parts = tok.split(/(<[^<>]+>)/).filter(Boolean);
    const count = parts.filter(p => PARAM_RE.test(p)).length;
    const names = [];
    const src = parts.map(p => {
      if (!PARAM_RE.test(p)) return escapeRe(p);
      names.push(p.slice(1, -1));
      return names.length === count ? '(.+)' : '(.+?)';
    }).join('');
    return { t: 'composite', names, re: new RegExp(`^${src}$`, 'i') };
  }
  return { t: 'kw', word: tok.toLowerCase() };
}

function parse(tokens) {
  let i = 0;
  function seq() {
    const items = [];
    while (i < tokens.length && !['|', ']', '}'].includes(tokens[i])) {
      const tok = tokens[i++];
      let node;
      if (tok === '[' || tok === '{') {
        const optional = tok === '[';
        node = { t: 'alt', optional, options: alt(optional ? ']' : '}') };
        if (tokens[i] === '*') { i++; node = { t: 'rep', node, min: optional ? 0 : 1, max: Infinity }; }
      } else if (tok === '*') {
        throw new Error('stray *');
      } else if (tok.startsWith('&<')) {
        const prev = items.pop();
        if (!prev) throw new Error('stray &<>');
        node = { t: 'rep', node: prev, min: 1, max: Number(/-(\d+)>/.exec(tok)[1]) };
      } else {
        node = leaf(tok);
      }
      items.push(node);
    }
    return { t: 'seq', items };
  }
  function alt(close) {
    const options = [seq()];
    while (tokens[i] === '|') { i++; options.push(seq()); }
    if (close) {
      if (tokens[i] !== close) throw new Error(`expected ${close}`);
      i++;
    }
    return options;
  }
  const options = alt(null);
  if (i < tokens.length) throw new Error(`unexpected ${tokens[i]}`);
  return options.length === 1 ? options[0] : { t: 'alt', optional: false, options };
}

const capture = (caps, name, value) => (name in caps ? caps : { ...caps, [name]: value });

function matchComposite(node, tok, st) {
  const m = tok === undefined ? null : node.re.exec(tok);
  if (!m) return null;
  let caps = st.caps;
  node.names.forEach((n, k) => { caps = capture(caps, n, m[k + 1]); });
  return { caps, lits: st.lits };
}

function* run(node, toks, st) {
  if (++steps > MAX_STEPS) return;
  switch (node.t) {
    case 'kw':
      if (toks[st.pos]?.toLowerCase() === node.word) yield { pos: st.pos + 1, caps: st.caps, lits: st.lits + 1 };
      return;
    case 'param':
      if (st.pos < toks.length) yield { pos: st.pos + 1, caps: capture(st.caps, node.name, toks[st.pos]), lits: st.lits };
      return;
    case 'composite': {
      const s = matchComposite(node, toks[st.pos], st);
      if (s) yield { pos: st.pos + 1, ...s };
      return;
    }
    case 'seq':
      yield* runSeq(node.items, 0, toks, st);
      return;
    case 'alt':
      for (const o of node.options) yield* run(o, toks, st);
      if (node.optional) yield st;
      return;
    case 'rep':
      yield* runRep(node, toks, st, 0);
      return;
  }
}

function* runSeq(items, i, toks, st) {
  if (i === items.length) { yield st; return; }
  const item = items[i];
  const next = items[i + 1];
  const tok = toks[st.pos];
  // Joined form: "GigabitEthernet0/2/1" for "GigabitEthernet <interface-number>".
  if (item.t === 'kw' && tok && (next?.t === 'param' || next?.t === 'composite')
      && tok.toLowerCase().startsWith(item.word) && /^\d/.test(tok.slice(item.word.length))) {
    const rest = tok.slice(item.word.length);
    const base = { caps: st.caps, lits: st.lits + 1 };
    const s = next.t === 'param' ? { caps: capture(base.caps, next.name, rest), lits: base.lits } : matchComposite(next, rest, base);
    if (s) yield* runSeq(items, i + 2, toks, { pos: st.pos + 1, ...s });
  }
  for (const s of run(item, toks, st)) yield* runSeq(items, i + 1, toks, s);
}

function* runRep(node, toks, st, count) {
  if (count < node.max) {
    for (const s of run(node.node, toks, st)) {
      if (s.pos === st.pos) continue;  // an empty repetition would loop forever
      yield* runRep(node, toks, s, count + 1);
    }
  }
  if (count >= node.min) yield st;
}

function bestReading(root, toks) {
  steps = 0;
  let best = null;
  let results = 0;
  for (const s of run(root, toks, { pos: 0, caps: {}, lits: 0 })) {
    if (s.pos === toks.length && (!best || s.lits > best.lits)) best = s;
    if (++results >= MAX_RESULTS) break;
  }
  return best;
}

export function compileSyntax(syntax) {
  try {
    const root = parse(tokenize(syntax));
    const head = root.t === 'seq' ? root.items[0] : null;
    return {
      syntax, ok: true, first: head?.t === 'kw' ? head.word : null,
      match(line) {
        const toks = lineTokens(line);
        if (!toks.length) return null;
        const best = bestReading(root, toks);
        return best ? { params: best.caps, literals: best.lits } : null;
      },
    };
  } catch {
    const prefix = [];
    for (const t of tokenize(syntax)) {
      if (!/^[A-Za-z][\w-]*$/.test(t)) break;
      prefix.push(t.toLowerCase());
    }
    return {
      syntax, ok: false, first: prefix[0] ?? null,
      match(line) {
        const toks = lineTokens(line).map(t => t.toLowerCase());
        if (!prefix.length || prefix.some((w, k) => toks[k] !== w)) return null;
        return { params: {}, literals: prefix.length, prefixOnly: true };
      },
    };
  }
}

export function compileCommand(cmd) {
  const forms = (cmd?.syntax ?? []).filter(s => !/^\s*undo\b/i.test(s)).map(compileSyntax);
  return {
    forms,
    match(line) {
      const first = lineTokens(line)[0]?.toLowerCase();
      let best = null;
      for (const f of forms) {
        if (f.first && f.first !== first) continue;
        const r = f.match(line);
        if (!r) continue;
        const prefixOnly = Boolean(r.prefixOnly);
        if (!best || (best.prefixOnly && !prefixOnly) || (best.prefixOnly === prefixOnly && r.literals > best.literals)) {
          best = { params: r.params, literals: r.literals, prefixOnly, syntax: f.syntax };
        }
      }
      return best;
    },
  };
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/syntax.test.js`
Expected: PASS. If the pathological test fails on time, lower `MAX_STEPS` only after checking that the other tests still pass; do not remove the test.

- [ ] **Step 5: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/syntax.js src/lib/syntax.test.js
git -C /mnt/c/code/cli-annotator commit -m "Match config lines against catalogue syntax" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 5: Interface types and shapes

**Files:**
- Create: `src/lib/interfaces.js`, `src/lib/interfaces.test.js`

**Interfaces:**
- Consumes: a bundle `viewIndex` (`{viewName: {entryCommand, params, parentView, enteredBy?}}`) as returned by `loadBundle` (Task 2), for v1 and v2 bundles alike.
- Produces:
  - `shapeOf(entryCommand: string|null) → {type: string, shape: 'main'|'sub'|'l2sub'} | null`. `type` keeps the catalogue's case (`GigabitEthernet`, `100GE`).
  - `buildInterfaceIndex(viewIndex) → {views: [{view, type, shape}], types: string[]}`. `types` is deduplicated case-insensitively and sorted longest first, so `100GE` is tried before `GE`.
  - `parseInterfaceOpener(text: string, types: string[]) → {type, number, sub, name, shape} | null`.
    - `type` is the index's spelling; `name` is compact and in the dump's case (`gigabitethernet0/2/1` for `interface gigabitethernet 0/2/1`); `sub` is a string or null.
    - Matching is case-insensitive, allows one space between type and number, and needs the number to start with a digit.
    - Anything after the interface id other than `mode l2` makes it null (unknown shape).

- [ ] **Step 1: Write the failing tests**

`src/lib/interfaces.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, buildInterfaceIndex, parseInterfaceOpener } from './interfaces.js';

test('shapeOf reads the type keyword and the shape of an interface entry command', () => {
  assert.deepEqual(shapeOf('interface GigabitEthernet <interface-number>'), { type: 'GigabitEthernet', shape: 'main' });
  assert.deepEqual(shapeOf('interface 100GE <interface-number>.<sub-number>'), { type: '100GE', shape: 'sub' });
  assert.deepEqual(shapeOf('interface 25GE <interface-number>.<sub-number> mode l2'), { type: '25GE', shape: 'l2sub' });
  assert.deepEqual(shapeOf('interface LoopBack <loopback-number>'), { type: 'LoopBack', shape: 'main' });
  assert.deepEqual(shapeOf('interface Eth-Trunk <trunk-id>'), { type: 'Eth-Trunk', shape: 'main' });
  assert.equal(shapeOf('interface <interface-type> <interface-number>'), null);
  assert.equal(shapeOf('isis <process-id>'), null);
  assert.equal(shapeOf(null), null);
});

const viewIndex = {
  'system view': { entryCommand: 'system-view', params: [], parentView: 'user view' },
  'ge interface view': { entryCommand: 'interface GigabitEthernet <interface-number>', params: ['interface-number'], parentView: 'system view' },
  'ge sub-interface view': { entryCommand: 'interface GigabitEthernet <interface-number>.<sub-number>', params: ['interface-number', 'sub-number'], parentView: 'system view' },
  '100ge interface view': { entryCommand: 'interface 100GE <interface-number>', params: ['interface-number'], parentView: 'system view' },
  'ge-alias view': { entryCommand: 'interface gigabitethernet <interface-number>', params: ['interface-number'], parentView: 'system view' },
  'loopback interface view': { entryCommand: 'interface LoopBack <loopback-number>', params: ['loopback-number'], parentView: 'system view' },
  'is-is view': { entryCommand: null, params: [], parentView: 'system view', enteredBy: ['f-isis'] },
};

test('buildInterfaceIndex lists interface views and their types, longest type first', () => {
  const idx = buildInterfaceIndex(viewIndex);
  assert.deepEqual(idx.types, ['GigabitEthernet', 'LoopBack', '100GE']);
  assert.deepEqual(idx.views.find(v => v.view === 'ge sub-interface view'), { view: 'ge sub-interface view', type: 'GigabitEthernet', shape: 'sub' });
  assert.equal(idx.views.some(v => v.view === 'is-is view'), false);
  assert.equal(idx.views.length, 5);
});

test('parseInterfaceOpener splits joined names and keeps the dump spelling in name', () => {
  const { types } = buildInterfaceIndex(viewIndex);
  assert.deepEqual(parseInterfaceOpener('interface GigabitEthernet0/2/1', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: null, name: 'GigabitEthernet0/2/1', shape: 'main' });
  assert.deepEqual(parseInterfaceOpener('interface GigabitEthernet0/2/1.111', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: '111', name: 'GigabitEthernet0/2/1.111', shape: 'sub' });
  assert.deepEqual(parseInterfaceOpener('interface GigabitEthernet0/2/1.77 mode l2', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: '77', name: 'GigabitEthernet0/2/1.77', shape: 'l2sub' });
  assert.deepEqual(parseInterfaceOpener('interface LoopBack0', types),
    { type: 'LoopBack', number: '0', sub: null, name: 'LoopBack0', shape: 'main' });
});

test('parseInterfaceOpener accepts another case and a space before the number', () => {
  const { types } = buildInterfaceIndex(viewIndex);
  assert.deepEqual(parseInterfaceOpener('interface gigabitethernet 0/2/1', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: null, name: 'gigabitethernet0/2/1', shape: 'main' });
  assert.deepEqual(parseInterfaceOpener('interface 100GE0/1/0', types),
    { type: '100GE', number: '0/1/0', sub: null, name: '100GE0/1/0', shape: 'main' });
});

test('parseInterfaceOpener returns null for unknown types, non-digit ids, other lines and unknown suffixes', () => {
  const { types } = buildInterfaceIndex(viewIndex);
  assert.equal(parseInterfaceOpener('interface Vlanif10', types), null);
  assert.equal(parseInterfaceOpener('interface GigabitEthernetX', types), null);
  assert.equal(parseInterfaceOpener('isis 207', types), null);
  assert.equal(parseInterfaceOpener('interface GigabitEthernet0/2/1 mode l3', types), null);
});
```

The expected `types` order is length descending (`GigabitEthernet` 15, `LoopBack` 8, `100GE` 5), and `ge-alias view`'s lowercase `gigabitethernet` is deduplicated into the first spelling seen.

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/interfaces.test.js`
Expected: FAIL — cannot find module `./interfaces.js`.

- [ ] **Step 3: Implement `src/lib/interfaces.js`**

```js
// Interface views in the catalogue: which interface type and shape each view's
// entry command opens, and how a dump's "interface 25GE0/2/8.3" splits up.
const ENTRY_RE = /^interface\s+([A-Za-z0-9][\w-]*)\s+<[^<>]+>(\.<[^<>]+>)?(\s+mode\s+l2)?\s*$/i;

export function shapeOf(entryCommand) {
  const m = ENTRY_RE.exec(entryCommand ?? '');
  if (!m) return null;
  return { type: m[1], shape: m[2] ? (m[3] ? 'l2sub' : 'sub') : 'main' };
}

export function buildInterfaceIndex(viewIndex) {
  const views = [];
  const types = new Map();  // lowercased → first spelling seen
  for (const [view, entry] of Object.entries(viewIndex ?? {})) {
    const s = shapeOf(entry?.entryCommand);
    if (!s) continue;
    if (!types.has(s.type.toLowerCase())) types.set(s.type.toLowerCase(), s.type);
    views.push({ view, type: types.get(s.type.toLowerCase()), shape: s.shape });
  }
  return { views, types: [...types.values()].sort((a, b) => b.length - a.length) };
}

const ID_RE = /^ ?(\d[\d/:]*)(?:\.(\d+))?(\s+mode\s+l2)?$/i;

export function parseInterfaceOpener(text, types) {
  const m = /^interface\s+(.+?)\s*$/i.exec(String(text).trim());
  if (!m) return null;
  const rest = m[1];
  for (const type of types) {
    if (!rest.toLowerCase().startsWith(type.toLowerCase())) continue;
    const id = ID_RE.exec(rest.slice(type.length));
    if (!id) continue;
    const [, number, sub = null, l2] = id;
    const name = rest.slice(0, type.length) + number + (sub ? `.${sub}` : '');
    return { type, number, sub, name, shape: sub ? (l2 ? 'l2sub' : 'sub') : 'main' };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/interfaces.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/interfaces.js src/lib/interfaces.test.js
git -C /mnt/c/code/cli-annotator commit -m "Read interface types and shapes from the view index" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 6: Resolve each block's candidate views

**Files:**
- Create: `src/lib/resolveViews.js`, `src/lib/resolveViews.test.js`

**Interfaces:**
- Consumes: `Loaded` from `loadBundle` (Task 2); `blocks` from `parseConfig` (Task 3; parents always come before their children); `compileSyntax`, `compileCommand` (Task 4); `buildInterfaceIndex`, `parseInterfaceOpener` (Task 5).
- Produces: `SYSTEM_VIEW = 'system view'`.
- Produces: `mappedViews(bundle) → Set<string>`: every `m.view` of a mapping plus every `parentViews` entry of a mapped command.
- Produces: `resolveViews(blocks, bundle, {equivalence = true} = {}) → BlockViews[]`, indexed by block id, where
  `BlockViews = {id, candidates: [{view, via: 'exact'|'equivalent', realView}], params: {name: value}, interface: ParsedInterface|null, resolved: boolean, owner: blockId}`.
  - **Interface openers** (top level, `parseInterfaceOpener` succeeds):
    - Exact candidates are the interface views of the same type and shape.
    - `params` come from matching the first exact view's entry command, else `{'interface-number', 'sub-number'}` from the parsed name.
    - With `equivalence`, every *mapped* interface view of the same shape (any type, LoopBack and Eth-Trunk included) is added as `via: 'equivalent'` with `realView` set to the first exact view.
  - **Other openers**: views whose `parentView` is in scope, matched by the view's entry command or by a command in its `enteredBy`. A null `parentView` counts as `system view`.
    - Prefix-only matches never resolve a view.
    - Top-level scope is `system view`; a nested block's scope is its parent's candidates. A nested candidate inherits the `via` of the parent candidate it was found under, and its `realView` is the view itself.
  - Candidates are ordered exact before equivalent, then in `viewIndex` order.
  - `owner` is the block itself when it resolved. An unresolved nested block takes its parent's owner, and an unresolved top-level block owns itself. A block under an unresolved parent has no scope, so it stays unresolved.

- [ ] **Step 1: Write the failing tests**

`src/lib/resolveViews.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { parseConfig } from './parseConfig.js';
import { resolveViews, mappedViews } from './resolveViews.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const bundle = loadBundle(raw);
const parsed = parseConfig(excerpt);
const opened = (views, p, n) => views[p.lines[n - 1].opens];

test('mappedViews collects mapping views and mapped commands\' parent views', () => {
  assert.deepEqual([...mappedViews(bundle)].sort(), [
    '100ge interface view', '100ge sub-interface view', 'ge interface view', 'ge sub-interface view',
    'is-is view', 'loopback interface view', 'system view', 'vpn instance view',
  ]);
});

test('an interface resolves exactly to its own view and equivalently to mapped views of the same shape', () => {
  const v = resolveViews(parsed.blocks, bundle);
  const ge = opened(v, parsed, 19);
  assert.deepEqual(ge.candidates, [
    { view: 'ge interface view', via: 'exact', realView: 'ge interface view' },
    { view: '100ge interface view', via: 'equivalent', realView: 'ge interface view' },
    { view: 'loopback interface view', via: 'equivalent', realView: 'ge interface view' },
  ]);
  assert.deepEqual(ge.params, { 'interface-number': '0/2/1' });
  assert.equal(ge.interface.name, 'GigabitEthernet0/2/1');
  assert.equal(ge.resolved, true);
  assert.equal(ge.owner, ge.id);

  const sub = opened(v, parsed, 25);
  assert.deepEqual(sub.candidates, [
    { view: 'ge sub-interface view', via: 'exact', realView: 'ge sub-interface view' },
    { view: '100ge sub-interface view', via: 'equivalent', realView: 'ge sub-interface view' },
  ]);
  assert.deepEqual(sub.params, { 'interface-number': '0/2/1', 'sub-number': '111' });

  const lo = opened(v, parsed, 30);
  assert.deepEqual(lo.candidates.map(c => [c.view, c.via]), [
    ['loopback interface view', 'exact'], ['ge interface view', 'equivalent'], ['100ge interface view', 'equivalent'],
  ]);
  assert.deepEqual(lo.params, { 'loopback-number': '0' });
});

test('with equivalence off an interface keeps only its exact view', () => {
  const v = resolveViews(parsed.blocks, bundle, { equivalence: false });
  assert.deepEqual(opened(v, parsed, 19).candidates.map(c => c.view), ['ge interface view']);
});

test('other openers resolve by entry command or by a command that enters the view', () => {
  const v = resolveViews(parsed.blocks, bundle);
  const isis = opened(v, parsed, 15);
  assert.deepEqual(isis.candidates, [{ view: 'is-is view', via: 'exact', realView: 'is-is view' }]);
  assert.deepEqual(isis.params, { 'process-id': '207' });
  assert.equal(isis.interface, null);
  assert.deepEqual(opened(v, parsed, 6).params, { 'vpn-instance-name': 'L3VPN_A' });
  assert.deepEqual(opened(v, parsed, 7).candidates.map(c => c.view), ['vpn instance ipv4 address family view']);
  const aaa = opened(v, parsed, 12);
  assert.equal(aaa.resolved, false);
  assert.deepEqual(aaa.candidates, []);
  assert.equal(aaa.owner, aaa.id);
  assert.equal(opened(v, parsed, 4).resolved, false);  // sysname
});

test('an interface typed in another case and with a space still resolves', () => {
  const p = parseConfig('interface gigabitethernet 0/2/1\n ip address 1.1.1.1 24\n#\n');
  const v = resolveViews(p.blocks, bundle);
  assert.equal(v[0].candidates[0].view, 'ge interface view');
  assert.deepEqual(v[0].params, { 'interface-number': '0/2/1' });
});

test('unresolved nested blocks take their parent\'s owner; under an unresolved parent nothing resolves', () => {
  const p = parseConfig('ip vpn-instance B\n ipv6-family\n  foo 1\n#\nbgp 100\n ipv4-family unicast\n  peer 1.1.1.1 enable\n#\n');
  const v = resolveViews(p.blocks, bundle);
  assert.deepEqual(v.map(b => [b.resolved, b.owner]), [[true, 0], [false, 0], [false, 2], [false, 2]]);
});

test('a v1 bundle only knows the mapped interface views', () => {
  const f = JSON.parse(raw);
  delete f.viewIndex;
  f.formatVersion = 1;
  const p = parseConfig('interface GigabitEthernet0/2/1\n undo shutdown\n#\ninterface 100GE0/1/0\n undo shutdown\n#\n');
  const v = resolveViews(p.blocks, loadBundle(f));
  assert.equal(v[0].resolved, false);
  assert.deepEqual(v[1].candidates, [{ view: '100ge interface view', via: 'exact', realView: '100ge interface view' }]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/resolveViews.test.js`
Expected: FAIL — cannot find module `./resolveViews.js`.

- [ ] **Step 3: Implement `src/lib/resolveViews.js`**

```js
// Works out which catalogue view(s) each block of a dump is in. Interfaces of
// another type stand in for the mapped ones ("equivalent") when that is on.
import { compileSyntax, compileCommand } from './syntax.js';
import { buildInterfaceIndex, parseInterfaceOpener } from './interfaces.js';

export const SYSTEM_VIEW = 'system view';

export function mappedViews(bundle) {
  const views = new Set();
  for (const m of bundle.mappings) if (m.view) views.add(m.view);
  for (const m of bundle.commandMappings) {
    for (const v of bundle.commands[m.featureId]?.parentViews ?? []) views.add(v);
  }
  return views;
}

// parentView → [{view, matchers}], matchers being the entry command and the commands that enter the view.
function openerIndex(bundle) {
  const byParent = new Map();
  for (const [view, e] of Object.entries(bundle.viewIndex)) {
    if (view === SYSTEM_VIEW) continue;
    const matchers = [];
    if (e.entryCommand) matchers.push(compileCommand({ syntax: [e.entryCommand] }));
    for (const fid of e.enteredBy ?? []) if (bundle.commands[fid]) matchers.push(compileCommand(bundle.commands[fid]));
    if (!matchers.length) continue;
    const parent = e.parentView ?? SYSTEM_VIEW;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push({ view, matchers });
  }
  return byParent;
}

function matchOpener(text, parentView, byParent) {
  const views = [];
  let params = null;
  for (const { view, matchers } of byParent.get(parentView) ?? []) {
    for (const m of matchers) {
      const r = m.match(text);
      if (!r || r.prefixOnly) continue;
      views.push(view);
      params ??= r.params;
      break;
    }
  }
  return { views, params: params ?? {} };
}

function interfaceCandidates(iface, text, bundle, ifIndex, mapped, equivalence) {
  const sameShape = ifIndex.views.filter(v => v.shape === iface.shape);
  const exact = sameShape.filter(v => v.type === iface.type).map(v => v.view);
  const candidates = exact.map(view => ({ view, via: 'exact', realView: view }));
  if (equivalence) {
    for (const v of sameShape) {
      if (mapped.has(v.view) && !exact.includes(v.view)) candidates.push({ view: v.view, via: 'equivalent', realView: exact[0] });
    }
  }
  const params = compileSyntax(bundle.viewIndex[exact[0]].entryCommand).match(text)?.params
    ?? { 'interface-number': iface.number, ...(iface.sub ? { 'sub-number': iface.sub } : {}) };
  return { candidates, params };
}

export function resolveViews(blocks, bundle, { equivalence = true } = {}) {
  const ifIndex = buildInterfaceIndex(bundle.viewIndex);
  const byParent = openerIndex(bundle);
  const mapped = mappedViews(bundle);
  const out = [];
  for (const b of blocks) {
    const parent = b.parent === null ? null : out[b.parent];
    const iface = b.parent === null ? parseInterfaceOpener(b.text, ifIndex.types) : null;
    let candidates = [];
    let params = {};
    if (iface) {
      ({ candidates, params } = interfaceCandidates(iface, b.text, bundle, ifIndex, mapped, equivalence));
    } else {
      const scopes = parent ? parent.candidates : [{ view: SYSTEM_VIEW, via: 'exact' }];
      for (const s of scopes) {
        const r = matchOpener(b.text, s.view, byParent);
        for (const view of r.views) {
          if (!candidates.some(c => c.view === view)) candidates.push({ view, via: s.via, realView: view });
        }
        if (r.views.length && !Object.keys(params).length) params = r.params;
      }
      candidates.sort((x, y) => (x.via === 'exact' ? 0 : 1) - (y.via === 'exact' ? 0 : 1));
    }
    const resolved = candidates.length > 0;
    out.push({ id: b.id, candidates, params, interface: iface, resolved, owner: resolved || !parent ? b.id : parent.owner });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/resolveViews.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/resolveViews.js src/lib/resolveViews.test.js
git -C /mnt/c/code/cli-annotator commit -m "Resolve each block's exact and equivalent catalogue views" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 7: Match lines to mappings

**Files:**
- Create: `src/lib/matchLines.js`, `src/lib/matchLines.test.js`

**Interfaces:**
- Consumes: `parseConfig` output (Task 3); `resolveViews` output and `SYSTEM_VIEW` (Task 6); `compileCommand` (Task 4); `Loaded` (Task 2).
- Produces: `ALL_VIEWS = 'all views'`.
- Produces: `matchLines(parsed, blockViews, bundle) → Match[]`, sorted by line number (stable: on one line, command matches come before view matches), where
  `Match = {n, block, view, via: 'exact'|'equivalent'|'enclosing'|'all', realView, mapping, kind: 'command'|'view', params, value, prefixOnly}`.
  - `block` is the block the match belongs to: for an opener line, the opened block's owner; for other lines, the owner of the block whose view matched.
  - A command mapping's **scope** is its command's `parentViews` plus `m.view`. On each candidate list it uses the first candidate in scope, so exact beats equivalent.
  - **Openers** are matched in their parent block's candidates (`system view` at the top level). **Other lines** are matched in their own block's candidates.
  - **Enclosing fallback:** if no scoped mapping matched, the enclosing blocks are tried outwards with `via: 'enclosing'`. This is how `route-distinguisher`, typed in the `ipv4-family` sub-block, reaches the VPN instance's mappings. The fallback never climbs to `system view`, so indented lines are not matched as top-level commands.
  - Mappings whose scope includes `all views` are tried on every config line with `view: 'all views'` and `via: 'all'`, including lines in unresolved blocks.
  - **View mappings** of each candidate view of a resolved block match the block's opener line, with the block's `params`. `value` is the `cliParameter` value, else the interface name, else the first param value, else the opener text.
  - A command match's `value` is `params[m.cliParameter]`, or null when the mapping has no parameter or it was not captured.

- [ ] **Step 1: Write the failing tests**

`src/lib/matchLines.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { parseConfig } from './parseConfig.js';
import { resolveViews } from './resolveViews.js';
import { matchLines, ALL_VIEWS } from './matchLines.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const parsed = parseConfig(excerpt);
const run = (bundle = loadBundle(raw), opts, p = parsed) => matchLines(p, resolveViews(p.blocks, bundle, opts), bundle);
const summary = ms => ms.map(m => [m.n, m.mapping.id, m.via, m.value]);

test('every mapped line of the excerpt matches, with its view relation and value', () => {
  assert.deepEqual(summary(run()), [
    [6, 'm-vrf', 'exact', 'L3VPN_A'],
    [8, 'm-rd', 'enclosing', '100:1'],
    [9, 'm-rt', 'enclosing', '100:1'],
    [10, 'm-rt', 'enclosing', '100:1'],
    [15, 'm-isis', 'exact', '207'],
    [17, 'm-net', 'exact', '49.0001.0010.0100.1207.00'],
    [19, 'm-ltp', 'equivalent', 'GigabitEthernet0/2/1'],
    [21, 'm-bind', 'exact', 'L3VPN_A'],
    [22, 'm-ip', 'exact', '10.0.0.1'],
    [23, 'm-isisen', 'equivalent', null],
    [25, 'm-ltp-sub', 'equivalent', 'GigabitEthernet0/2/1.111'],
    [26, 'm-vlan', 'equivalent', '111'],
    [28, 'm-l2vc', 'exact', '7'],
    [30, 'm-ltp', 'equivalent', 'LoopBack0'],
    [31, 'm-ip', 'exact', '1.1.1.207'],
  ]);
});

test('matches carry their view, the real view and the block they belong to', () => {
  const ms = run();
  const at = n => ms.find(m => m.n === n);
  const vpnBlock = parsed.lines[5].opens;
  assert.deepEqual([at(8).view, at(8).block, at(8).kind], ['vpn instance view', vpnBlock, 'command']);
  assert.equal(at(6).kind, 'view');
  assert.equal(at(6).block, vpnBlock);
  assert.equal(at(15).block, parsed.lines[14].opens);
  assert.deepEqual([at(23).view, at(23).realView], ['100ge interface view', 'ge interface view']);
  assert.deepEqual(at(28).params, { 'instance-name': 'GigabitEthernet0/2/1.111', 'ip-address': '192.0.2.9', 'vc-id': '7' });
  assert.equal(at(22).prefixOnly, false);
});

test('with equivalence off only exact views and the enclosing fallback match', () => {
  const ms = run(undefined, { equivalence: false });
  assert.deepEqual([...new Set(ms.map(m => m.n))], [6, 8, 9, 10, 15, 17, 21, 22, 28, 31]);
});

test('all-views mappings match on every line, also inside unresolved blocks', () => {
  const f = JSON.parse(raw);
  f.commands['f-host'] = { title: 'sysname', syntax: ['sysname <host-name>'], parentViews: [ALL_VIEWS], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-host', sourceType: 'command', featureId: 'f-host', title: 'sysname', view: ALL_VIEWS, viewFamily: null,
    cliParameter: 'host-name', isKey: false, keyHint: null, dte: { id: 'Twin_NE', entity: 'NE', field: 'name' }, relation: 'configures', topology: [] });
  const ms = run(loadBundle(f));
  assert.deepEqual(summary(ms.filter(m => m.mapping.id === 'm-host')), [[4, 'm-host', 'all', 'PE207']]);
  const p = parseConfig('aaa\n sysname X\n#\n');
  const inAaa = run(loadBundle(f), undefined, p);
  assert.deepEqual(summary(inAaa), [[2, 'm-host', 'all', 'X']]);
  assert.equal(inAaa[0].view, ALL_VIEWS);
});

test('a command whose syntax is not understood matches by its leading keywords, flagged prefixOnly', () => {
  const f = JSON.parse(raw);
  f.commands['f-mtu'] = { title: 'mtu', syntax: ['mtu <mtu> [ spread'], parentViews: ['ge sub-interface view'], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-mtu', sourceType: 'command', featureId: 'f-mtu', title: 'mtu', view: 'ge sub-interface view', viewFamily: null,
    cliParameter: 'mtu', isKey: false, keyHint: null, dte: { id: 'Twin_FixedNetworkLTP', entity: 'FixedNetworkLTP', field: 'mtu' }, relation: 'configures', topology: [] });
  const m = run(loadBundle(f)).find(x => x.mapping.id === 'm-mtu');
  assert.deepEqual([m.n, m.prefixOnly, m.value], [27, true, null]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/matchLines.test.js`
Expected: FAIL — cannot find module `./matchLines.js`.

- [ ] **Step 3: Implement `src/lib/matchLines.js`**

```js
// Matches every config line against the command mappings of its block's views,
// and puts each resolved block's view mappings on its opener line.
import { compileCommand } from './syntax.js';
import { SYSTEM_VIEW } from './resolveViews.js';

export const ALL_VIEWS = 'all views';
const SYSTEM = [{ view: SYSTEM_VIEW, via: 'exact', realView: SYSTEM_VIEW }];

function viewValue(m, params, iface, text) {
  if (m.cliParameter && params[m.cliParameter] != null) return params[m.cliParameter];
  if (iface) return iface.name;
  return Object.values(params)[0] ?? text;
}

function commandMatch(n, block, c, via, m, r) {
  return {
    n, block, view: c.view, via, realView: c.realView, mapping: m, kind: 'command',
    params: r.params, value: m.cliParameter ? r.params[m.cliParameter] ?? null : null, prefixOnly: r.prefixOnly,
  };
}

export function matchLines(parsed, blockViews, bundle) {
  const { lines, blocks } = parsed;
  const matchers = new Map();
  const scoped = [];
  const everywhere = [];
  for (const m of bundle.commandMappings) {
    const cmd = bundle.commands[m.featureId];
    if (!matchers.has(m.featureId)) matchers.set(m.featureId, compileCommand(cmd));
    const scope = new Set([...(cmd.parentViews ?? []), m.view].filter(Boolean));
    (scope.has(ALL_VIEWS) ? everywhere : scoped).push({ m, scope, matcher: matchers.get(m.featureId) });
  }

  const out = [];
  for (const line of lines) {
    if (line.kind !== 'config') continue;
    const memo = new Map();
    const run = matcher => {
      if (!memo.has(matcher)) memo.set(matcher, matcher.match(line.text));
      return memo.get(matcher);
    };
    const opener = line.opens !== null;
    const attributed = opener ? blockViews[line.opens].owner : null;
    let ctx = opener ? blocks[line.opens].parent : line.block;
    let cands = ctx === null ? SYSTEM : blockViews[ctx].candidates;
    let enclosing = false;
    for (;;) {
      const block = attributed ?? blockViews[ctx].owner;
      let found = 0;
      for (const { m, scope, matcher } of scoped) {
        const c = cands.find(x => scope.has(x.view));
        const r = c && run(matcher);
        if (!r) continue;
        out.push(commandMatch(line.n, block, c, enclosing ? 'enclosing' : c.via, m, r));
        found++;
      }
      if (found || ctx === null || blocks[ctx].parent === null) break;
      ctx = blocks[ctx].parent;
      cands = blockViews[ctx].candidates;
      enclosing = true;
    }
    const block = attributed ?? blockViews[line.block].owner;
    const all = { view: ALL_VIEWS, realView: ALL_VIEWS };
    for (const { m, matcher } of everywhere) {
      const r = run(matcher);
      if (r) out.push(commandMatch(line.n, block, all, 'all', m, r));
    }
  }

  for (const bv of blockViews) {
    const b = blocks[bv.id];
    const seen = new Set();
    for (const c of bv.candidates) {
      for (const m of bundle.viewMappings[c.view] ?? []) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({
          n: b.opener, block: bv.owner, view: c.view, via: c.via, realView: c.realView, mapping: m, kind: 'view',
          params: bv.params, value: viewValue(m, bv.params, bv.interface, b.text), prefixOnly: false,
        });
      }
    }
  }
  return out.sort((x, y) => x.n - y.n);
}
```

Notes for the implementer:
- `ctx === null` happens only for top-level openers; `blockViews[ctx].owner` is then never read, because `attributed` is set.
- The `block` for all-views matches uses the opened block for an opener and the line's own block otherwise.

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/matchLines.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/matchLines.js src/lib/matchLines.test.js
git -C /mnt/c/code/cli-annotator commit -m "Match config lines to command and view mappings" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 8: Build instances and narrow topology

**Files:**
- Create: `src/lib/buildInstances.js`, `src/lib/buildInstances.test.js`

**Interfaces:**
- Consumes: `Match[]` from `matchLines` (Task 7); `parseConfig` output (Task 3); `resolveViews` output (Task 6); `Loaded` (Task 2).
- Produces: `STOPWORDS: Set<string>` and `titleTokens(title) → string[]`. Tokens are the lowercased runs of letters with 3+ letters that are not stopwords, deduplicated.
- Produces: `buildInstances(matches, parsed, blockViews, bundle) → Instance[]`, sorted by opener line, then entity name. Each instance is

  ```
  {id: `${dteId}@L${opener}`, block, opener, view, via, name,
   dte: {id, entity, fields: {field: [values, deduplicated, in line order]}},
   topology: string[], topologyCandidates: string[], lines: number[],
   matches: [{n, mappingId, field, value, via}]}
  ```

  - **Grouping:** one group per (DTE entity, `match.block`). A group with no key match (`mapping.isKey`) joins the nearest enclosing block's group for the same DTE entity, if there is one; deeper groups merge first.
  - **`view` / `via`:** taken from the key match, else from the first match.
  - **`name`:** the key match's value. Else the first value of a field that a key mapping of the same DTE entity uses (VRF `vrfName` from `ip binding vpn-instance` → `L3VPN_A`). Else the block's interface name. Else the opener text.
  - **`topologyCandidates`:** `bundle.dteEntities[id].topology` entities, falling back to the mapping's `topology`.
  - **`topology`** is narrowed to the union of two rules, keeping candidate order. If neither rule keeps anything, all candidates are kept.
    - **Keyword:** candidates whose entity name contains a title token of a command mapping matched in this instance (`isis enable` → `isisinterface`).
    - **Schema:** candidates in the same topology schema as a topology entity of another DTE entity reached by a command mapping in the same block (`ip binding vpn-instance` → VRF → `l3vpninstance` → `l3vpnsap`).

- [ ] **Step 1: Write the failing tests**

`src/lib/buildInstances.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { parseConfig } from './parseConfig.js';
import { resolveViews } from './resolveViews.js';
import { matchLines } from './matchLines.js';
import { buildInstances, titleTokens } from './buildInstances.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const parsed = parseConfig(excerpt);
const build = (bundle = loadBundle(raw)) => {
  const views = resolveViews(parsed.blocks, bundle);
  return buildInstances(matchLines(parsed, views, bundle), parsed, views, bundle);
};
const find = (list, opener, entity) => list.find(i => i.opener === opener && i.dte.entity === entity);

test('titleTokens keeps distinctive words of a command title', () => {
  assert.deepEqual(titleTokens('isis enable'), ['isis']);
  assert.deepEqual(titleTokens('ip binding vpn-instance'), ['binding', 'vpn']);
  assert.deepEqual(titleTokens('vlan-type dot1q'), ['vlan', 'dot']);
  assert.deepEqual(titleTokens(null), []);
});

test('one instance per block and DTE entity, named by key, key field, interface or opener', () => {
  assert.deepEqual(build().map(i => [i.opener, i.dte.entity, i.name]), [
    [6, 'VRF', 'L3VPN_A'],
    [15, 'IGP', '207'],
    [19, 'FixedNetworkLTP', 'GigabitEthernet0/2/1'],
    [19, 'LTP', 'GigabitEthernet0/2/1'],
    [19, 'VRF', 'L3VPN_A'],
    [25, 'FixedNetworkLTP', 'GigabitEthernet0/2/1.111'],
    [25, 'LTP', 'GigabitEthernet0/2/1.111'],
    [25, 'PW', 'GigabitEthernet0/2/1.111'],
    [30, 'FixedNetworkLTP', 'LoopBack0'],
    [30, 'LTP', 'LoopBack0'],
  ]);
});

test('fields collect deduplicated values from every line of the instance', () => {
  const list = build();
  const vrf = find(list, 6, 'VRF');
  assert.equal(vrf.id, 'Twin_VRF@L6');
  assert.deepEqual(vrf.dte.fields, { vrfName: ['L3VPN_A'], rd: ['100:1'], rt: ['100:1'] });
  assert.deepEqual(vrf.lines, [6, 8, 9, 10]);
  assert.deepEqual([vrf.view, vrf.via], ['vpn instance view', 'exact']);
  assert.deepEqual(find(list, 15, 'IGP').dte.fields, { igpId: ['207'], networkEntityId: ['49.0001.0010.0100.1207.00'] });
  assert.deepEqual(find(list, 25, 'PW').dte.fields, { pwId: ['7'] });
  assert.deepEqual(find(list, 19, 'FixedNetworkLTP').matches, [
    { n: 22, mappingId: 'm-ip', field: 'IP__addrv4', value: '10.0.0.1', via: 'exact' },
    { n: 23, mappingId: 'm-isisen', field: null, value: null, via: 'equivalent' },
  ]);
});

test('topology candidates narrow by command keywords and by sibling entities\' schemas', () => {
  const list = build();
  const all = ['ethernetport', 'vlaninterface', 'ipv4interface', 'isisinterface', 'vpwssap', 'l3vpnsap'];
  const ge = find(list, 19, 'FixedNetworkLTP');
  assert.deepEqual(ge.topology, ['isisinterface', 'l3vpnsap']);
  assert.deepEqual(ge.topologyCandidates, all);
  assert.deepEqual(find(list, 25, 'FixedNetworkLTP').topology, ['vlaninterface', 'vpwssap']);
  assert.deepEqual(find(list, 30, 'FixedNetworkLTP').topology, all);
  assert.deepEqual(find(list, 19, 'LTP').topology, ['ethernetport']);
});

test('a keyless group in a nested block joins the enclosing instance of the same entity', () => {
  const f = JSON.parse(raw);
  const fam = 'vpn instance ipv4 address family view';
  for (const fid of ['f-rd', 'f-rt']) f.commands[fid].parentViews = [fam];
  for (const m of f.mappings) if (m.id === 'm-rd' || m.id === 'm-rt') m.view = fam;
  const list = build(loadBundle(f));
  assert.equal(list.some(i => i.opener === 7), false);
  const vrf = find(list, 6, 'VRF');
  assert.deepEqual(vrf.dte.fields, { vrfName: ['L3VPN_A'], rd: ['100:1'], rt: ['100:1'] });
  assert.deepEqual(vrf.matches.map(m => [m.n, m.via]), [[6, 'exact'], [8, 'exact'], [9, 'exact'], [10, 'exact']]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/buildInstances.test.js`
Expected: FAIL — cannot find module `./buildInstances.js`.

- [ ] **Step 3: Implement `src/lib/buildInstances.js`**

```js
// Groups matches into DTE entity instances (one per block and entity) and picks
// the topology entities each instance most likely is.
export const STOPWORDS = new Set([
  'enable', 'disable', 'interface', 'view', 'address', 'type', 'instance', 'name', 'mode', 'undo', 'display', 'config',
]);

export function titleTokens(title) {
  const words = String(title ?? '').toLowerCase().split(/[^a-z]+/);
  return [...new Set(words.filter(w => w.length >= 3 && !STOPWORDS.has(w)))];
}

function narrow(cands, ownTitles, otherSchemas) {
  const tokens = ownTitles.flatMap(titleTokens);
  const keep = cands.filter(c =>
    tokens.some(t => c.entity.toLowerCase().includes(t)) || (c.schema && otherSchemas.has(c.schema)));
  return (keep.length ? keep : cands).map(c => c.entity);
}

export function buildInstances(matches, parsed, blockViews, bundle) {
  const { blocks } = parsed;
  const groups = new Map();
  for (const m of matches) {
    const key = `${m.mapping.dte.id}@${m.block}`;
    if (!groups.has(key)) groups.set(key, { dteId: m.mapping.dte.id, entity: m.mapping.dte.entity, block: m.block, matches: [] });
    groups.get(key).matches.push(m);
  }

  // Keyless groups join the nearest enclosing group of the same DTE entity, deepest first.
  const deepestFirst = [...groups.entries()].sort(([, a], [, b]) => blocks[b.block].depth - blocks[a.block].depth);
  for (const [key, g] of deepestFirst) {
    if (g.matches.some(m => m.mapping.isKey)) continue;
    for (let b = blocks[g.block].parent; b !== null; b = blocks[b].parent) {
      const target = groups.get(`${g.dteId}@${b}`);
      if (!target) continue;
      target.matches.push(...g.matches);
      groups.delete(key);
      break;
    }
  }

  const keyFields = new Map();  // dteId → fields that key mappings fill
  for (const m of bundle.mappings) {
    if (!m.isKey || !m.dte?.field) continue;
    if (!keyFields.has(m.dte.id)) keyFields.set(m.dte.id, []);
    keyFields.get(m.dte.id).push(m.dte.field);
  }
  const commandDte = new Map();  // block → DTE ids reached by command mappings in it
  for (const m of matches) {
    if (m.kind !== 'command') continue;
    if (!commandDte.has(m.block)) commandDte.set(m.block, new Set());
    commandDte.get(m.block).add(m.mapping.dte.id);
  }
  const topologyOf = id => bundle.dteEntities[id]?.topology ?? null;

  const instances = [];
  for (const g of groups.values()) {
    const ms = g.matches.sort((a, b) => a.n - b.n);
    const fields = {};
    for (const m of ms) {
      const f = m.mapping.dte.field;
      if (!f || m.value == null) continue;
      fields[f] ??= [];
      if (!fields[f].includes(m.value)) fields[f].push(m.value);
    }
    const block = blocks[g.block];
    const key = ms.find(m => m.mapping.isKey && m.value != null);
    const keyField = (keyFields.get(g.dteId) ?? []).find(f => fields[f]?.length);
    const name = key?.value ?? (keyField ? fields[keyField][0] : null) ?? blockViews[g.block].interface?.name ?? block.text;
    const first = key ?? ms[0];

    const cands = topologyOf(g.dteId) ?? ms[0].mapping.topology.map(entity => ({ entity, schema: null }));
    const otherSchemas = new Set();
    for (const id of commandDte.get(g.block) ?? []) {
      if (id === g.dteId) continue;
      for (const t of topologyOf(id) ?? []) if (t.schema) otherSchemas.add(t.schema);
    }
    const ownTitles = ms.filter(m => m.kind === 'command').map(m => m.mapping.title);

    instances.push({
      id: `${g.dteId}@L${block.opener}`, block: g.block, opener: block.opener, view: first.view, via: first.via, name,
      dte: { id: g.dteId, entity: g.entity, fields },
      topology: narrow(cands, ownTitles, otherSchemas),
      topologyCandidates: cands.map(c => c.entity),
      lines: [...new Set(ms.map(m => m.n))],
      matches: ms.map(m => ({ n: m.n, mappingId: m.mapping.id, field: m.mapping.dte.field, value: m.value, via: m.via })),
    });
  }
  return instances.sort((a, b) => a.opener - b.opener || a.dte.entity.localeCompare(b.dte.entity));
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/buildInstances.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/buildInstances.js src/lib/buildInstances.test.js
git -C /mnt/c/code/cli-annotator commit -m "Group matches into DTE instances and narrow their topology" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 9: Redact secrets

**Files:**
- Create: `src/lib/redact.js`, `src/lib/redact.test.js`

**Interfaces:**
- Consumes: `Line[]` from `parseConfig` (Task 3).
- Produces: `MASK = '****'`.
- Produces: `redactLine(text) → string`, which masks a line's secret values with these rules, applied in order:
  - `%^%#…%^%#` strings → `****`
  - `$1x$…` hashes → `****`
  - the word after `cipher`, `irreversible-cipher`, `simple`, `plain`
  - the word after `password`, unless it is `cipher`, `irreversible-cipher`, `simple` or `plain`
  - the word after `authentication-mode md5|hmac-sha1|hmac-sha256`, unless it is `cipher`, `plain`, `simple` or `key-id`
  - the word after `snmp-agent community read|write`, unless it is `cipher`

  Each rule keeps its keyword and masks only the value.
- Produces: `redactLines(lines: Line[]) → Line[]`: copies of every line with `text` redacted and a `redacted: boolean` field. It also keeps state across lines: each line between `public-key-code begin` and `public-key-code end` becomes its indentation plus `****`.
- `annotate` (Task 10) matches the **redacted** text, so captured parameter values never contain a secret.

- [ ] **Step 1: Write the failing tests**

`src/lib/redact.test.js` (every secret here is made up):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from './parseConfig.js';
import { redactLine, redactLines, MASK } from './redact.js';

test('masks the value and keeps the keyword', () => {
  const cases = [
    [' local-user admin password irreversible-cipher $1c$FAKEfake$', ' local-user admin password irreversible-cipher ****'],
    [' isis authentication-mode md5 cipher %^%#FAKE fake%^%#', ' isis authentication-mode md5 cipher ****'],
    [' ospf authentication-mode hmac-sha256 key-id 1 plain FakePlain1', ' ospf authentication-mode hmac-sha256 key-id 1 plain ****'],
    [' authentication-mode md5 FakeBare1', ' authentication-mode md5 ****'],
    [' password simple FakeSimple1', ' password simple ****'],
    [' password FakeBare2', ' password ****'],
    ['snmp-agent community read FakeCommunity', 'snmp-agent community read ****'],
    ['snmp-agent community write cipher %^%#FAKE%^%#', 'snmp-agent community write cipher ****'],
    [' peer 10.0.0.2 password cipher %^%#FAKE%^%# ', ' peer 10.0.0.2 password cipher **** '],
  ];
  for (const [input, want] of cases) assert.equal(redactLine(input), want, input);
});

test('leaves lines without secrets unchanged', () => {
  for (const t of [' ip address 10.0.0.1 255.255.255.252', ' isis enable 207', 'sysname PE207', ' authentication-mode md5']) {
    assert.equal(redactLine(t), t);
  }
});

test('masks public-key-code bodies and flags redacted lines', () => {
  const text = [
    'rsa peer-public-key peer1',
    ' public-key-code begin',
    '  3082010A 02820101 00FAKE00',
    '  00FAKE01',
    ' public-key-code end',
    ' peer-public-key end',
    '#',
    'aaa',
    ' local-user u1 password irreversible-cipher FAKE',
    '#',
    'return',
  ].join('\n');
  const lines = redactLines(parseConfig(text).lines);
  assert.deepEqual(lines.map(l => l.text), [
    'rsa peer-public-key peer1',
    ' public-key-code begin',
    `  ${MASK}`,
    `  ${MASK}`,
    ' public-key-code end',
    ' peer-public-key end',
    '#',
    'aaa',
    ` local-user u1 password irreversible-cipher ${MASK}`,
    '#',
    'return',
  ]);
  assert.deepEqual(lines.filter(l => l.redacted).map(l => l.n), [3, 4, 9]);
  assert.deepEqual(lines.map(({ n, indent, kind, block, opens }) => ({ n, indent, kind, block, opens })),
    parseConfig(text).lines.map(({ n, indent, kind, block, opens }) => ({ n, indent, kind, block, opens })));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/redact.test.js`
Expected: FAIL — cannot find module `./redact.js`.

- [ ] **Step 3: Implement `src/lib/redact.js`**

```js
// Masks secret values in config lines, keeping the keyword before each value.
export const MASK = '****';

const RULES = [
  [/%\^%#.*?%\^%#/g, MASK],
  [/\$1[a-z]\$\S*/g, MASK],
  [/\b(irreversible-cipher|cipher|simple|plain)(\s+)\S+/g, `$1$2${MASK}`],
  [/\b(password)(\s+)(?!(?:irreversible-cipher|cipher|simple|plain)\b)\S+/g, `$1$2${MASK}`],
  [/\b(authentication-mode\s+(?:md5|hmac-sha1|hmac-sha256))(\s+)(?!(?:cipher|plain|simple|key-id)\b)\S+/g, `$1$2${MASK}`],
  [/\b(snmp-agent\s+community\s+(?:read|write))(\s+)(?!cipher\b)\S+/g, `$1$2${MASK}`],
];

export function redactLine(text) {
  return RULES.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function redactLines(lines) {
  let inKey = false;
  return lines.map(line => {
    const body = line.text.trim();
    let text;
    if (inKey && /^public-key-code\s+end\b/i.test(body)) inKey = false;
    if (inKey) text = line.text.match(/^\s*/)[0] + MASK;
    else text = redactLine(line.text);
    if (/^public-key-code\s+begin\b/i.test(body)) inKey = true;
    return { ...line, text, redacted: text !== line.text };
  });
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/redact.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/redact.js src/lib/redact.test.js
git -C /mnt/c/code/cli-annotator commit -m "Redact secret values in config lines" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 10: `annotate` — the whole pipeline

**Files:**
- Create: `src/lib/annotate.js`, `src/lib/annotate.test.js`

**Interfaces:**
- Consumes: `loadBundle` (Task 2), `parseConfig` (Task 3), `resolveViews` (Task 6), `matchLines` (Task 7), `buildInstances` (Task 8), `redactLines` (Task 9).
- Produces: `annotate(text: string, bundle: string|object|Loaded, {equivalence = true, redact = true} = {}) → Result`. A `Loaded` (it has `commandMappings`) is used as is; anything else goes through `loadBundle`, which throws on an invalid bundle. Nothing throws on dump input.
- With `redact`, the lines are redacted **before** matching, and each block's `text` is re-read from its redacted opener line. Captured values therefore never hold a secret.
- `Result`:

  ```
  {options: {equivalence, redact},
   device: {softwareVersion, sysname},
   bundle: {device, generatedAt, formatVersion},
   warnings: string[],
   lines: [{n, text, kind, indent, block, opens, redacted, views: [{view, via, realView}], matches: LineMatch[]}],
   blocks: [{id, opener, text, parent, depth, children, candidates, params, interface, resolved, owner}],
   instances: Instance[],            // Task 8
   gaps,                             // the bundle's gaps
   unmatched: number[],              // config lines with no match
   coverage: {mappings: {total, found}, byMapping: {mappingId: lineCount},
              lines: {config, matched}, blocks: {total, unresolved: [{id, opener, text}]}}}
  LineMatch = {mappingId, title, kind, featureId, view, via, realView, dte: {id, entity, field},
               relation, cliParameter, value, params, prefixOnly, instance: instanceId|null}
  ```

  - A line's `views` are the candidates of the block it opens, else of the block it sits in.
  - `coverage.blocks` counts blocks with children; `unresolved` lists those with no candidate view.
  - Warnings, after the bundle's own:
    - no `!Software Version` header: `The dump has no "!Software Version" header, so its software version was not checked.`
    - a different version: `The dump's software version V800R025C10SPC500 differs from the bundle's V800R022C00SPC600; command syntax may differ.`
    - prefix-only matches: `Matched by leading keywords only (syntax not understood): mtu.`

- [ ] **Step 1: Write the failing tests**

`src/lib/annotate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { annotate } from './annotate.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const lineAt = (r, n) => r.lines[n - 1];
const pairs = (r, n) => lineAt(r, n).matches.map(m => [m.mappingId, m.via]);

test('annotates the excerpt end to end', () => {
  const r = annotate(excerpt, raw);
  assert.deepEqual(r.options, { equivalence: true, redact: true });
  assert.deepEqual(r.device, { softwareVersion: 'V800R025C10SPC500', sysname: 'PE207' });
  assert.deepEqual(r.coverage.mappings, { total: 12, found: 12 });
  assert.deepEqual(r.coverage.lines, { config: 22, matched: 15 });
  assert.equal(r.coverage.byMapping['m-rt'], 2);
  assert.deepEqual(r.unmatched, [4, 7, 12, 13, 16, 20, 27]);
  assert.equal(r.coverage.blocks.total, 7);
  assert.deepEqual(r.coverage.blocks.unresolved.map(b => [b.opener, b.text]), [[12, 'aaa']]);
  assert.deepEqual(pairs(r, 22), [['m-ip', 'exact']]);
  assert.deepEqual(pairs(r, 23), [['m-isisen', 'equivalent']]);
  assert.deepEqual(pairs(r, 30), [['m-ltp', 'equivalent']]);
  assert.deepEqual(lineAt(r, 19).views.map(v => [v.view, v.via]).slice(0, 2),
    [['ge interface view', 'exact'], ['100ge interface view', 'equivalent']]);
  assert.equal(lineAt(r, 22).matches[0].instance, 'Twin_FixedNetworkLTP@L19');
  assert.equal(lineAt(r, 22).matches[0].value, '10.0.0.1');
  assert.deepEqual(lineAt(r, 22).matches[0].dte, { id: 'Twin_FixedNetworkLTP', entity: 'FixedNetworkLTP', field: 'IP__addrv4' });
  const loop = r.instances.filter(i => i.opener === 30).map(i => [i.dte.entity, i.via]);
  assert.deepEqual(loop, [['FixedNetworkLTP', 'exact'], ['LTP', 'equivalent']]);
  assert.deepEqual(r.instances.find(i => i.opener === 19 && i.dte.entity === 'FixedNetworkLTP').topology, ['isisinterface', 'l3vpnsap']);
  assert.deepEqual(r.gaps, JSON.parse(raw).gaps);
});

test('switching equivalence off keeps only exact and enclosing matches', () => {
  const r = annotate(excerpt, raw, { equivalence: false });
  assert.deepEqual(r.lines.filter(l => l.matches.length).map(l => l.n), [6, 8, 9, 10, 15, 17, 21, 22, 28, 31]);
  assert.deepEqual(r.coverage.lines, { config: 22, matched: 10 });
});

test('accepts a loaded bundle, a parsed object or JSON text alike', () => {
  const a = annotate(excerpt, raw);
  assert.deepEqual(annotate(excerpt, loadBundle(raw)), a);
  assert.deepEqual(annotate(excerpt, JSON.parse(raw)), a);
  assert.throws(() => annotate(excerpt, '{"format":"other"}'), /Not an annotation bundle/);
});

test('warns about a missing header, a version mismatch and prefix-only matches', () => {
  const f = JSON.parse(raw);
  f.device.softwareVersion = 'V800R025C10SPC500';
  assert.deepEqual(annotate(excerpt, f).warnings, []);
  f.device.softwareVersion = 'X1';
  assert.ok(annotate(excerpt, f).warnings.some(w => /software version V800R025C10SPC500 differs from the bundle's X1/.test(w)));
  const noHeader = excerpt.split('\n').slice(1).join('\n');
  assert.ok(annotate(noHeader, f).warnings.some(w => /no "!Software Version" header/.test(w)));
  f.commands['f-mtu'] = { title: 'mtu', syntax: ['mtu <mtu> [ spread'], parentViews: ['ge sub-interface view'], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-mtu', sourceType: 'command', featureId: 'f-mtu', title: 'mtu', view: 'ge sub-interface view', viewFamily: null,
    cliParameter: 'mtu', isKey: false, keyHint: null, dte: { id: 'Twin_FixedNetworkLTP', entity: 'FixedNetworkLTP', field: 'mtu' },
    relation: 'configures', relationType: '1:1', topology: [] });
  assert.ok(annotate(excerpt, f).warnings.includes('Matched by leading keywords only (syntax not understood): mtu.'));
});

test('a secret captured as a mapped value is masked everywhere when redaction is on', () => {
  const f = JSON.parse(raw);
  f.viewIndex['aaa view'] = { entryCommand: 'aaa', params: [], parentView: 'system view' };
  f.commands['f-user'] = { title: 'local-user password', syntax: ['local-user <user-name> password irreversible-cipher <password>'],
    parentViews: ['aaa view'], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-user', sourceType: 'command', featureId: 'f-user', title: 'local-user password', view: 'aaa view', viewFamily: null,
    cliParameter: 'password', isKey: false, keyHint: null, dte: { id: 'Twin_User', entity: 'User', field: 'password' },
    relation: 'configures', relationType: '1:1', topology: [] });

  const r = annotate(excerpt, f);
  const m = lineAt(r, 13).matches[0];
  assert.equal(m.mappingId, 'm-user');
  assert.equal(m.value, '****');
  assert.equal(m.params.password, '****');
  assert.equal(lineAt(r, 13).redacted, true);
  assert.deepEqual(r.instances.find(i => i.dte.id === 'Twin_User').dte.fields, { password: ['****'] });
  assert.equal(JSON.stringify(r).includes('FAKESECRET'), false);

  const open = annotate(excerpt, f, { redact: false });
  assert.equal(lineAt(open, 13).matches[0].value, '$1c$FAKESECRETFAKE$');
  assert.equal(lineAt(open, 13).redacted, false);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/annotate.test.js`
Expected: FAIL — cannot find module `./annotate.js`.

- [ ] **Step 3: Implement `src/lib/annotate.js`**

```js
// Runs the whole pipeline on one dump: parse → redact → resolve views → match → instances.
import { loadBundle } from './bundle.js';
import { parseConfig } from './parseConfig.js';
import { redactLines } from './redact.js';
import { resolveViews } from './resolveViews.js';
import { matchLines } from './matchLines.js';
import { buildInstances } from './buildInstances.js';

function dumpWarnings(parsed, loaded, matches) {
  const out = [];
  const want = loaded.device?.softwareVersion;
  if (!parsed.softwareVersion) {
    out.push('The dump has no "!Software Version" header, so its software version was not checked.');
  } else if (want && parsed.softwareVersion !== want) {
    out.push(`The dump's software version ${parsed.softwareVersion} differs from the bundle's ${want}; command syntax may differ.`);
  }
  const loose = [...new Set(matches.filter(m => m.prefixOnly).map(m => m.mapping.title || m.mapping.id))];
  if (loose.length) out.push(`Matched by leading keywords only (syntax not understood): ${loose.join(', ')}.`);
  return out;
}

export function annotate(text, bundle, { equivalence = true, redact = true } = {}) {
  const loaded = bundle?.commandMappings ? bundle : loadBundle(bundle);
  let parsed = parseConfig(text);
  if (redact) {
    const lines = redactLines(parsed.lines);
    parsed = { ...parsed, lines, blocks: parsed.blocks.map(b => ({ ...b, text: lines[b.opener - 1].text.trim() })) };
  }
  const views = resolveViews(parsed.blocks, loaded, { equivalence });
  const matches = matchLines(parsed, views, loaded);
  const instances = buildInstances(matches, parsed, views, loaded);

  const instanceOf = new Map();
  for (const i of instances) for (const m of i.matches) instanceOf.set(`${m.n}|${m.mappingId}`, i.id);
  const byLine = new Map();
  for (const m of matches) {
    if (!byLine.has(m.n)) byLine.set(m.n, []);
    byLine.get(m.n).push({
      mappingId: m.mapping.id, title: m.mapping.title, kind: m.kind, featureId: m.mapping.featureId,
      view: m.view, via: m.via, realView: m.realView, dte: m.mapping.dte, relation: m.mapping.relation,
      cliParameter: m.mapping.cliParameter, value: m.value, params: m.params, prefixOnly: m.prefixOnly,
      instance: instanceOf.get(`${m.n}|${m.mapping.id}`) ?? null,
    });
  }

  const lines = parsed.lines.map(l => {
    const own = l.opens ?? l.block;
    return {
      n: l.n, text: l.text, kind: l.kind, indent: l.indent, block: l.block, opens: l.opens, redacted: Boolean(l.redacted),
      views: own === null ? [] : views[own].candidates, matches: byLine.get(l.n) ?? [],
    };
  });
  const config = lines.filter(l => l.kind === 'config');
  const byMapping = Object.fromEntries(loaded.mappings.map(m => [m.id, 0]));
  for (const l of lines) for (const id of new Set(l.matches.map(m => m.mappingId))) byMapping[id] = (byMapping[id] ?? 0) + 1;
  const blocks = parsed.blocks.map(b => {
    const v = views[b.id];
    return { ...b, candidates: v.candidates, params: v.params, interface: v.interface, resolved: v.resolved, owner: v.owner };
  });
  const parents = blocks.filter(b => b.children.length);

  return {
    options: { equivalence, redact },
    device: { softwareVersion: parsed.softwareVersion, sysname: parsed.sysname },
    bundle: { device: loaded.device, generatedAt: loaded.generatedAt, formatVersion: loaded.formatVersion },
    warnings: [...loaded.warnings, ...dumpWarnings(parsed, loaded, matches)],
    lines, blocks, instances,
    gaps: loaded.gaps,
    unmatched: config.filter(l => !l.matches.length).map(l => l.n),
    coverage: {
      mappings: { total: loaded.mappings.length, found: Object.values(byMapping).filter(c => c > 0).length },
      byMapping,
      lines: { config: config.length, matched: config.filter(l => l.matches.length).length },
      blocks: {
        total: parents.length,
        unresolved: parents.filter(b => !b.resolved).map(b => ({ id: b.id, opener: b.opener, text: b.text })),
      },
    },
  };
}
```

Notes for the implementer:
- `loadBundle` deep-copies nothing but `viewIndex`; `annotate` never mutates the bundle, so passing the same `Loaded` to several dumps is safe.
- If the fixture bundle's `device.softwareVersion` already equals the excerpt's, the first test still passes; the warning test sets the version explicitly.

- [ ] **Step 4: Run all core tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/`
Expected: PASS, every `src/lib` test file.

- [ ] **Step 5: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/annotate.js src/lib/annotate.test.js
git -C /mnt/c/code/cli-annotator commit -m "Run the annotation pipeline on a dump" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 11: Exports — JSON instances, annotated text, HTML report

**Files:**
- Create: `src/lib/export/json.js`, `src/lib/export/text.js`, `src/lib/export/html.js`
- Create: `src/lib/export/export.test.js`

**Interfaces:**
- Consumes: `Result` from `annotate` (Task 10). The exports read only the result, which is already redacted when redaction is on, so every download follows the redaction setting.
- Produces: `toInstancesJson(result, {dumpFile = null} = {}) → object` (the caller stringifies it):

  ```
  {format: 'cli-annotator.instances', version: 1, dumpFile, device, bundle, options, warnings,
   coverage: {mappings, lines}, instances: [{id, block, opener, view, via, name, dte, topology, topologyCandidates, lines}]}
  ```

- Produces: `matchNote(lineMatch, instancesById: Map) → string`, formatted as `DTE <Entity>[.<field>][=<value>][ | topo a, b][ ≈ <view>]`.
  - `topo` is the match's instance's narrowed `topology`.
  - `≈ <view>` appears only for `via: 'equivalent'` and names the mapped view the block stands in for.
- Produces: `toAnnotatedText(result) → string`. It is the dump unchanged, with comment lines added at the line's own indentation:
  - after an opener, one `! @ <Entity> <name>` line per instance it opens, in instance order;
  - then one `! @ <matchNote>` per match on the line.

  The output ends with a newline.
- Produces: `escapeHtml(s) → string` and `toHtmlReport(result, {dumpFile = null} = {}) → string`, one self-contained HTML document: inline CSS (light and dark), no scripts. It has:
  - a header with the device and versions, the redaction state and the warnings
  - coverage figures
  - an instances table whose first column links to `#L<opener>`
  - the full dump, one `div.ln#L<n>` per line, with a `via-<via>` class when matched and the match notes beside the line
  - the bundle's gaps

  All text is escaped.

- [ ] **Step 1: Write the failing tests**

`src/lib/export/export.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annotate } from '../annotate.js';
import { toInstancesJson } from './json.js';
import { toAnnotatedText, matchNote } from './text.js';
import { toHtmlReport, escapeHtml } from './html.js';

const raw = readFileSync(new URL('../../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const result = annotate(excerpt, raw);

test('JSON instances carry the device, bundle, coverage and every instance', () => {
  const j = toInstancesJson(result, { dumpFile: 'device_207.txt' });
  assert.equal(j.format, 'cli-annotator.instances');
  assert.equal(j.version, 1);
  assert.equal(j.dumpFile, 'device_207.txt');
  assert.deepEqual(j.device, result.device);
  assert.deepEqual(j.coverage, { mappings: result.coverage.mappings, lines: result.coverage.lines });
  assert.equal(j.instances.length, result.instances.length);
  const vrf = j.instances.find(i => i.id === 'Twin_VRF@L6');
  assert.deepEqual(Object.keys(vrf), ['id', 'block', 'opener', 'view', 'via', 'name', 'dte', 'topology', 'topologyCandidates', 'lines']);
  assert.equal(JSON.stringify(j).includes('FAKESECRET'), false);
});

test('match notes name the entity, field, value, topology and the stood-in view', () => {
  const byId = new Map(result.instances.map(i => [i.id, i]));
  const note = n => result.lines[n - 1].matches.map(m => matchNote(m, byId));
  assert.deepEqual(note(22), ['DTE FixedNetworkLTP.IP__addrv4=10.0.0.1 | topo isisinterface, l3vpnsap']);
  assert.deepEqual(note(23), ['DTE FixedNetworkLTP | topo isisinterface, l3vpnsap ≈ 100ge interface view']);
  assert.match(note(8)[0], /^DTE VRF\.rd=100:1( \| topo .+)?$/);
});

test('annotated text is the dump plus comment lines', () => {
  const text = toAnnotatedText(result);
  assert.ok(text.endsWith('\n'));
  const notes = text.split('\n').filter(l => /^\s*! @ /.test(l));
  assert.ok(notes.length > 15);
  const stripped = text.split('\n').filter(l => !/^\s*! @ /.test(l)).join('\n');
  assert.equal(stripped, result.lines.map(l => l.text).join('\n') + '\n');
  assert.ok(text.includes([
    'interface GigabitEthernet0/2/1',
    '! @ FixedNetworkLTP GigabitEthernet0/2/1',
    '! @ LTP GigabitEthernet0/2/1',
    '! @ VRF L3VPN_A',
  ].join('\n')));
  assert.match(text, /^! @ DTE LTP(\.\w+)?=GigabitEthernet0\/2\/1 \| topo ethernetport ≈ 100ge interface view$/m);
  assert.ok(text.includes(' ip address 10.0.0.1 255.255.255.0\n ! @ DTE FixedNetworkLTP.IP__addrv4=10.0.0.1 | topo isisinterface, l3vpnsap\n'));
});

test('the HTML report is self-contained and escapes dump text', () => {
  const html = toHtmlReport(annotate(excerpt.replace(' undo shutdown', ' description <b>core</b> & "x"'), raw), { dumpFile: 'device_207.txt' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('description &lt;b&gt;core&lt;/b&gt; &amp; &quot;x&quot;'));
  assert.equal(html.includes('<b>core</b>'), false);
  assert.equal(/<script/i.test(html), false);
  assert.equal(/\b(src|href)="(https?:)?\/\//i.test(html), false);
  assert.ok(html.includes('id="L22"'));
  assert.ok(html.includes('href="#L19"'));
  assert.match(html, /class="ln via-equivalent" id="L23"/);
  assert.ok(html.includes('device_207.txt'));
  assert.equal(escapeHtml(`<a href='x'>&</a>`), '&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/export/`
Expected: FAIL — cannot find module `./json.js`.

- [ ] **Step 3: Implement `src/lib/export/json.js`**

```js
// The instances of one annotated dump, for other tools.
export function toInstancesJson(result, { dumpFile = null } = {}) {
  return {
    format: 'cli-annotator.instances',
    version: 1,
    dumpFile,
    device: result.device,
    bundle: result.bundle,
    options: result.options,
    warnings: result.warnings,
    coverage: { mappings: result.coverage.mappings, lines: result.coverage.lines },
    instances: result.instances.map(i => ({
      id: i.id, block: i.block, opener: i.opener, view: i.view, via: i.via, name: i.name,
      dte: i.dte, topology: i.topology, topologyCandidates: i.topologyCandidates, lines: i.lines,
    })),
  };
}
```

- [ ] **Step 4: Implement `src/lib/export/text.js`**

```js
// The dump with `! @` comment lines, which stay valid comments in device syntax.
export function matchNote(m, instancesById) {
  let s = `DTE ${m.dte.entity}`;
  if (m.dte.field) s += `.${m.dte.field}`;
  if (m.value != null) s += `=${m.value}`;
  const topo = instancesById.get(m.instance)?.topology ?? [];
  if (topo.length) s += ` | topo ${topo.join(', ')}`;
  if (m.via === 'equivalent') s += ` ≈ ${m.view}`;
  return s;
}

export function toAnnotatedText(result) {
  const byId = new Map(result.instances.map(i => [i.id, i]));
  const heads = new Map();
  for (const i of result.instances) {
    if (!heads.has(i.opener)) heads.set(i.opener, []);
    heads.get(i.opener).push(i);
  }
  const out = [];
  for (const l of result.lines) {
    out.push(l.text);
    const pad = ' '.repeat(l.indent);
    for (const i of heads.get(l.n) ?? []) out.push(`${pad}! @ ${i.dte.entity} ${i.name}`);
    for (const m of l.matches) out.push(`${pad}! @ ${matchNote(m, byId)}`);
  }
  return out.join('\n') + '\n';
}
```

- [ ] **Step 5: Implement `src/lib/export/html.js`**

```js
// One self-contained HTML report: inline CSS, no scripts, every text escaped.
import { matchNote } from './text.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);
const e = escapeHtml;

const CSS = `
:root { --bg: #fff; --fg: #1d2330; --muted: #6b7280; --line: #e5e7eb; --exact: #2f7d4f; --equiv: #b7791f; --enc: #4a6fa5; --note: #f3f4f6; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171f; --fg: #e5e7eb; --muted: #9ca3af; --line: #2a2f3a; --exact: #4fbf7f; --equiv: #e0a84a; --enc: #7f9fd0; --note: #1f2430; } }
body { margin: 0 auto; max-width: 1200px; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 8px; }
.muted { color: var(--muted); } .warn { color: var(--equiv); }
table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid var(--line); padding: 4px 6px; text-align: left; vertical-align: top; }
.dump { font: 12px/1.5 ui-monospace, monospace; overflow-x: auto; }
.ln { display: flex; gap: 8px; border-left: 3px solid transparent; padding-left: 4px; white-space: pre; }
.ln .n { color: var(--muted); min-width: 3em; text-align: right; text-decoration: none; }
.ln.via-exact { border-left-color: var(--exact); } .ln.via-equivalent { border-left: 3px dashed var(--equiv); }
.ln.via-enclosing, .ln.via-all { border-left: 3px dotted var(--enc); }
.note { background: var(--note); color: var(--muted); border-radius: 4px; padding: 0 6px; font-family: system-ui, sans-serif; }
`;

const fieldText = fields => Object.entries(fields).map(([f, v]) => `${f}=${v.join(', ')}`).join('; ');

function gapList(title, items, label) {
  if (!items?.length) return '';
  return `<h3>${e(title)} (${items.length})</h3><ul>${items.map(x => `<li>${e(label(x))}</li>`).join('')}</ul>`;
}

export function toHtmlReport(result, { dumpFile = null } = {}) {
  const byId = new Map(result.instances.map(i => [i.id, i]));
  const { device, bundle, coverage: c, gaps = {} } = result;
  const name = device.sysname ?? dumpFile ?? 'device';
  const instances = result.instances.map(i => `<tr><td><a href="#L${i.opener}">${i.opener}</a></td><td>${e(i.dte.entity)}</td>`
    + `<td>${e(i.name)}</td><td>${e(fieldText(i.dte.fields))}</td><td>${e(i.topology.join(', '))}</td>`
    + `<td>${e(i.view)}${i.via === 'exact' ? '' : ` <span class="muted">(${e(i.via)})</span>`}</td></tr>`).join('\n');
  const dump = result.lines.map(l => {
    const via = l.matches[0]?.via;
    const notes = l.matches.map(m => `<span class="note">${e(matchNote(m, byId))}</span>`).join('');
    return `<div class="ln${via ? ` via-${via}` : ''}" id="L${l.n}"><a class="n" href="#L${l.n}">${l.n}</a><code>${e(l.text)}</code>${notes}</div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(name)} — CLI annotation</title><style>${CSS}</style></head><body>
<h1>${e(name)} — CLI annotation</h1>
<p class="muted">${dumpFile ? `${e(dumpFile)} · ` : ''}dump ${e(device.softwareVersion ?? 'version unknown')} · bundle ${e(bundle.device?.name)} ${e(bundle.device?.softwareVersion)}, ${e(bundle.generatedAt)} · secrets ${result.options.redact ? 'redacted' : '<strong>not redacted</strong>'} · interface equivalence ${result.options.equivalence ? 'on' : 'off'}</p>
${result.warnings.length ? `<ul class="warn">${result.warnings.map(w => `<li>${e(w)}</li>`).join('')}</ul>` : ''}
<h2>Coverage</h2>
<p>${c.mappings.found} of ${c.mappings.total} mappings found · ${c.lines.matched} of ${c.lines.config} config lines matched · ${c.blocks.unresolved.length} of ${c.blocks.total} blocks with an unknown view${c.blocks.unresolved.length ? `: ${c.blocks.unresolved.map(b => `<a href="#L${b.opener}">${e(b.text)}</a>`).join(', ')}` : ''}</p>
<h2>Instances (${result.instances.length})</h2>
<table><thead><tr><th>Line</th><th>DTE entity</th><th>Name</th><th>Fields</th><th>Topology</th><th>View</th></tr></thead><tbody>
${instances}
</tbody></table>
<h2>Configuration</h2>
<div class="dump">
${dump}
</div>
<h2>Gaps in the bundle</h2>
${gapList('DTE entities with no CLI mapping', gaps.dteWithoutCli, g => `${g.logicalName} (topology: ${(g.topology ?? []).join(', ')})`)}
${gapList('Topology entities with no DTE mapping', gaps.topologyWithoutDte, g => `${g.entity} (${g.schema})`)}
${gapList('Schema names a DTE entity not in the dataset', gaps.dteNotFound, g => `${g.topologyEntity} → ${g.dteEntity}`)}
</body></html>
`;
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/lib/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /mnt/c/code/cli-annotator add src/lib/export
git -C /mnt/c/code/cli-annotator commit -m "Export JSON instances, annotated text and an HTML report" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 12: The web page

**Files:**
- Create: `src/files.js`, `src/lastBundle.js`, `src/browser.test.js`
- Create: `src/components/InputsBar.jsx`, `src/components/DumpView.jsx`, `src/components/LineDetail.jsx`, `src/components/SummaryPanel.jsx`, `src/components/ExportBar.jsx`
- Replace: `src/App.jsx`, `src/App.css`
- Modify: `package.json` (`"test"` also runs `src/browser.test.js`)

**Interfaces:**
- Consumes: `loadBundle` (Task 2), `annotate` and `Result` (Task 10), `toInstancesJson`, `toAnnotatedText`, `matchNote`, `toHtmlReport` (Task 11).
- Produces: `readFiles(fileList) → Promise<[{name, text}]>`, `baseName(fileName) → string` (drops the last extension), `download(fileName, content, type)` (a Blob URL and a temporary `<a download>`).
- Produces: `rememberBundle(name, generatedAt)` and `lastBundle() → {name, generatedAt}|null`. They use the localStorage key `cli-annotator.lastBundle`, wrapped in try/catch. Only the bundle's name and time are stored; dumps and bundle contents live in React state only.
- The page:
  - **Inputs bar:** a bundle drop zone, a dumps drop zone (several files), Paste, one tab per dump, and checkboxes for interface equivalence and redaction (both on).
  - **Centre:** a filter (All / Matched / Unmatched), a search box, the export buttons, the warnings, then the dump.
  - **Side panel:** the clicked line's detail, or the summary when no line is selected.
- File inputs carry `data-input="bundle"` / `data-input="dumps"`, and each dump line is `div.ln#L<n>`, so the smoke test can drive them.

- [ ] **Step 1: Write the failing tests for the browser helpers**

`src/browser.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseName, readFiles } from './files.js';
import { lastBundle, rememberBundle } from './lastBundle.js';

test('baseName drops the last extension only', () => {
  assert.equal(baseName('device_207.txt'), 'device_207');
  assert.equal(baseName('topo-cli-bundle-NE8000.v2.json'), 'topo-cli-bundle-NE8000.v2');
  assert.equal(baseName('noext'), 'noext');
});

test('readFiles reads every file as text', async () => {
  const files = [new File(['a\n'], 'one.txt'), new File(['b'], 'two.txt')];
  assert.deepEqual(await readFiles(files), [{ name: 'one.txt', text: 'a\n' }, { name: 'two.txt', text: 'b' }]);
});

test('the last bundle is remembered by name and time only, and storage failures are ignored', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(lastBundle(), null);
  rememberBundle('b.json', '2026-10-21T09:00:00.000Z');
  assert.deepEqual(JSON.parse(store.get('cli-annotator.lastBundle')), { name: 'b.json', generatedAt: '2026-10-21T09:00:00.000Z' });
  assert.deepEqual(lastBundle(), { name: 'b.json', generatedAt: '2026-10-21T09:00:00.000Z' });
  store.set('cli-annotator.lastBundle', 'not json');
  assert.equal(lastBundle(), null);
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => rememberBundle('b.json', null));
  assert.equal(lastBundle(), null);
  delete globalThis.localStorage;
});
```

In `package.json`, set `"test": "node --test src/lib/ src/browser.test.js"`.

- [ ] **Step 2: Run them and see them fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && node --test src/browser.test.js`
Expected: FAIL — cannot find module `./files.js`.

- [ ] **Step 3: Implement the helpers**

`src/files.js`:

```js
// File input and download helpers. Nothing here leaves the browser.
export function readFiles(fileList) {
  return Promise.all([...fileList].map(async f => ({ name: f.name, text: await f.text() })));
}

export function baseName(name) {
  return name.replace(/\.[^./\\]+$/, '');
}

export function download(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

`src/lastBundle.js`:

```js
// Remembers only the last bundle's file name and generation time, as a reminder of
// what to drop again. The bundle and dumps themselves are never stored.
const KEY = 'cli-annotator.lastBundle';

export function rememberBundle(name, generatedAt) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name, generatedAt: generatedAt ?? null }));
  } catch {
    // Storage blocked or full: the reminder is optional.
  }
}

export function lastBundle() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v.name === 'string' ? { name: v.name, generatedAt: v.generatedAt ?? null } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && npm test`
Expected: PASS.

- [ ] **Step 5: Write the components**

`src/components/InputsBar.jsx`:

```jsx
import { useState } from 'react';

function DropZone({ input, label, hint, accept, multiple, onFiles }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`drop${over ? ' over' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
    >
      <input type="file" hidden data-input={input} accept={accept} multiple={multiple}
        onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
      <span className="drop-label">{label}</span>
      <span className="drop-hint">{hint}</span>
    </label>
  );
}

export default function InputsBar({
  bundle, remembered, onBundleFiles, onDumpFiles, onPaste,
  dumps, active, onSelectDump, onCloseDump, equivalence, onEquivalence, redact, onRedact,
}) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const bundleHint = bundle
    ? `${bundle.name} · ${bundle.loaded.device?.name ?? ''} ${bundle.loaded.device?.softwareVersion ?? ''}`
    : remembered ? `Last used: ${remembered.name}. Drop it again.` : 'Exported from ontology-ui (CLI page)';
  return (
    <header className="inputs">
      <div className="inputs-row">
        <DropZone input="bundle" label={bundle ? 'Bundle ✓' : 'Bundle'} hint={bundleHint} accept=".json,application/json" onFiles={onBundleFiles} />
        <DropZone input="dumps" label="Dumps" hint="display current-configuration files" accept=".txt,.cfg,.log,text/plain" multiple onFiles={onDumpFiles} />
        <button type="button" onClick={() => setPasting(p => !p)}>{pasting ? 'Cancel paste' : 'Paste'}</button>
        <label className="toggle"><input type="checkbox" checked={equivalence} onChange={e => onEquivalence(e.target.checked)} /> Interface equivalence</label>
        <label className="toggle"><input type="checkbox" checked={redact} onChange={e => onRedact(e.target.checked)} /> Redact secrets</label>
        <span className="local-note">Files stay in this browser.</span>
      </div>
      {pasting && (
        <div className="paste">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste a configuration dump" rows={6} />
          <button type="button" disabled={!text.trim()} onClick={() => { onPaste(text); setText(''); setPasting(false); }}>Add dump</button>
        </div>
      )}
      {dumps.length > 0 && (
        <nav className="tabs">
          {dumps.map((d, i) => (
            <span key={`${i}-${d.name}`} className={`tab${i === active ? ' active' : ''}`}>
              <button type="button" onClick={() => onSelectDump(i)}>{d.name}</button>
              <button type="button" className="close" aria-label={`Close ${d.name}`} onClick={() => onCloseDump(i)}>×</button>
            </span>
          ))}
        </nav>
      )}
    </header>
  );
}
```

`src/components/DumpView.jsx`:

```jsx
import { useEffect } from 'react';

const chip = m => `${m.dte.entity}${m.dte.field ? `.${m.dte.field}` : ''}`;

function visible(line, filter, needle) {
  if (filter === 'matched' && !line.matches.length) return false;
  if (filter === 'unmatched' && (line.kind !== 'config' || line.matches.length)) return false;
  return !needle || line.text.toLowerCase().includes(needle);
}

export default function DumpView({ result, filter, search, selected, onSelect }) {
  useEffect(() => {
    if (selected) document.getElementById(`L${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const needle = search.trim().toLowerCase();
  const lines = result.lines.filter(l => visible(l, filter, needle));
  return (
    <div className="dump" role="list">
      {lines.map(l => {
        const via = l.matches[0]?.via;
        return (
          <div key={l.n} id={`L${l.n}`} role="listitem"
            className={`ln ln-${l.kind}${via ? ` via-${via}` : ''}${l.n === selected ? ' sel' : ''}`}
            onClick={() => onSelect(l.n === selected ? null : l.n)}>
            <span className="n">{l.n}</span>
            <code>{l.text}</code>
            {l.matches.map((m, i) => <span key={i} className={`chip via-${m.via}`} title={`${m.title} (${m.via})`}>{chip(m)}</span>)}
          </div>
        );
      })}
      {!lines.length && <p className="muted pad">No lines match the filter.</p>}
    </div>
  );
}
```

`src/components/LineDetail.jsx`:

```jsx
const viaText = { exact: 'exact view', equivalent: 'equivalent view', enclosing: 'enclosing block', all: 'all views' };

export default function LineDetail({ line, result, bundle, onClose }) {
  const byId = new Map(result.instances.map(i => [i.id, i]));
  return (
    <div className="detail">
      <div className="detail-head">
        <h2>Line {line.n}</h2>
        <button type="button" onClick={onClose}>Summary</button>
      </div>
      <pre className="detail-line">{line.text}</pre>
      {line.views.length > 0 && (
        <p className="muted">Block view: {line.views.map(v => (v.via === 'exact' ? v.view : `${v.view} (${v.via})`)).join(', ')}</p>
      )}
      {!line.matches.length && <p className="muted">No mapping matches this line.</p>}
      {line.matches.map((m, i) => {
        const cmd = m.featureId ? bundle.commands[m.featureId] : null;
        const inst = byId.get(m.instance);
        return (
          <section key={i} className="match">
            <h3>{m.title} <span className={`badge via-${m.via}`}>{viaText[m.via]}</span></h3>
            {m.via === 'equivalent' && <p className="muted">Mapped on {m.view}; this block is {m.realView}.</p>}
            <dl>
              <dt>DTE</dt><dd>{m.dte.entity}{m.dte.field ? `.${m.dte.field}` : ''} <span className="muted">({m.relation})</span></dd>
              {m.value != null && <><dt>Value</dt><dd><code>{m.value}</code></dd></>}
              {inst && <><dt>Instance</dt><dd>{inst.dte.entity} {inst.name}</dd></>}
              {inst && <><dt>Topology</dt><dd>{inst.topology.join(', ') || '—'}
                {inst.topology.length < inst.topologyCandidates.length && <span className="muted"> (of {inst.topologyCandidates.join(', ')})</span>}</dd></>}
            </dl>
            {m.prefixOnly && <p className="warn">Matched by leading keywords only: the syntax was not understood.</p>}
            {cmd && (
              <div className="cmd">
                {cmd.syntax.filter(s => !/^undo\b/i.test(s)).map(s => <code key={s} className="syntax">{s}</code>)}
                {cmd.parameters.length > 0 && (
                  <dl className="params">
                    {cmd.parameters.map(p => <div key={p.name}><dt>{p.name}</dt><dd>{p.description}</dd></div>)}
                  </dl>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

`src/components/SummaryPanel.jsx`:

```jsx
function Gap({ title, items, label }) {
  if (!items?.length) return null;
  return (
    <details>
      <summary>{title} ({items.length})</summary>
      <ul>{items.map((g, i) => <li key={i}>{label(g)}</li>)}</ul>
    </details>
  );
}

export default function SummaryPanel({ result, onSelectLine }) {
  const { device, coverage: c, gaps = {} } = result;
  return (
    <div className="summary">
      <h2>{device.sysname ?? 'Device'}</h2>
      <p className="muted">Software {device.softwareVersion ?? 'unknown'}</p>
      <div className="stats">
        <div><strong>{c.mappings.found}/{c.mappings.total}</strong><span>mappings found</span></div>
        <div><strong>{c.lines.matched}/{c.lines.config}</strong><span>config lines matched</span></div>
        <div><strong>{result.instances.length}</strong><span>instances</span></div>
      </div>
      {c.blocks.unresolved.length > 0 && (
        <details>
          <summary>Blocks with an unknown view ({c.blocks.unresolved.length} of {c.blocks.total})</summary>
          <ul>{c.blocks.unresolved.map(b => <li key={b.id}><button type="button" className="link" onClick={() => onSelectLine(b.opener)}>{b.opener}: {b.text}</button></li>)}</ul>
        </details>
      )}
      <h3>Instances</h3>
      <ul className="instances">
        {result.instances.map(i => (
          <li key={i.id}>
            <button type="button" className="link" onClick={() => onSelectLine(i.opener)}>
              <strong>{i.dte.entity}</strong> {i.name}
            </button>
            <span className="muted"> {i.topology.join(', ')}{i.via === 'exact' ? '' : ` · ${i.via}`}</span>
          </li>
        ))}
      </ul>
      <h3>Gaps in the bundle</h3>
      <Gap title="DTE entities with no CLI mapping" items={gaps.dteWithoutCli} label={g => `${g.logicalName} (${(g.topology ?? []).join(', ')})`} />
      <Gap title="Topology entities with no DTE mapping" items={gaps.topologyWithoutDte} label={g => `${g.entity} (${g.schema})`} />
      <Gap title="Schema names a missing DTE entity" items={gaps.dteNotFound} label={g => `${g.topologyEntity} → ${g.dteEntity}`} />
    </div>
  );
}
```

`src/components/ExportBar.jsx`:

```jsx
import { baseName, download } from '../files.js';
import { toInstancesJson } from '../lib/export/json.js';
import { toAnnotatedText } from '../lib/export/text.js';
import { toHtmlReport } from '../lib/export/html.js';

export default function ExportBar({ result, dumpName }) {
  const base = baseName(dumpName);
  return (
    <div className="exports">
      <button type="button" onClick={() => download(`${base}-annotated.html`, toHtmlReport(result, { dumpFile: dumpName }), 'text/html')}>HTML report</button>
      <button type="button" onClick={() => download(`${base}-instances.json`, JSON.stringify(toInstancesJson(result, { dumpFile: dumpName }), null, 2), 'application/json')}>JSON instances</button>
      <button type="button" onClick={() => download(`${base}-annotated.txt`, toAnnotatedText(result), 'text/plain')}>Annotated text</button>
      {!result.options.redact && <span className="warn">Exports include secrets</span>}
    </div>
  );
}
```

- [ ] **Step 6: Replace `src/App.jsx`**

```jsx
import { useMemo, useState } from 'react';
import { loadBundle } from './lib/bundle.js';
import { annotate } from './lib/annotate.js';
import { readFiles } from './files.js';
import { lastBundle, rememberBundle } from './lastBundle.js';
import InputsBar from './components/InputsBar.jsx';
import DumpView from './components/DumpView.jsx';
import LineDetail from './components/LineDetail.jsx';
import SummaryPanel from './components/SummaryPanel.jsx';
import ExportBar from './components/ExportBar.jsx';

const FILTERS = [['all', 'All'], ['matched', 'Matched'], ['unmatched', 'Unmatched']];

export default function App() {
  const [bundle, setBundle] = useState(null);            // {name, loaded}
  const [bundleError, setBundleError] = useState(null);
  const [remembered] = useState(lastBundle);
  const [tabs, setTabs] = useState({ list: [], active: 0 });  // dumps live in memory only
  const [equivalence, setEquivalence] = useState(true);
  const [redact, setRedact] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const dump = tabs.list[tabs.active] ?? null;
  const { result, error } = useMemo(() => {
    if (!bundle || !dump) return { result: null, error: null };
    try {
      return { result: annotate(dump.text, bundle.loaded, { equivalence, redact }), error: null };
    } catch (e) {
      return { result: null, error: e.message };
    }
  }, [bundle, dump, equivalence, redact]);
  const line = result && selected ? result.lines[selected - 1] : null;

  async function onBundleFiles(files) {
    const [f] = await readFiles(files);
    if (!f) return;
    try {
      const loaded = loadBundle(f.text);
      setBundle({ name: f.name, loaded });
      setBundleError(null);
      rememberBundle(f.name, loaded.generatedAt);
    } catch (e) {
      setBundleError(`${f.name}: ${e.message}`);
    }
  }
  function addDumps(added) {
    if (!added.length) return;
    setTabs(t => ({ list: [...t.list, ...added], active: t.list.length }));
    setSelected(null);
  }
  function closeDump(i) {
    setTabs(t => {
      const list = t.list.filter((_, j) => j !== i);
      const active = t.active > i ? t.active - 1 : t.active;
      return { list, active: Math.min(active, Math.max(list.length - 1, 0)) };
    });
    setSelected(null);
  }

  return (
    <div className="app">
      <InputsBar
        bundle={bundle} remembered={remembered}
        onBundleFiles={onBundleFiles}
        onDumpFiles={async files => addDumps(await readFiles(files))}
        onPaste={text => addDumps([{ name: `pasted-${tabs.list.length + 1}.txt`, text }])}
        dumps={tabs.list} active={tabs.active}
        onSelectDump={i => { setTabs(t => ({ ...t, active: i })); setSelected(null); }}
        onCloseDump={closeDump}
        equivalence={equivalence} onEquivalence={setEquivalence}
        redact={redact} onRedact={setRedact}
      />
      {bundleError && <p className="error">{bundleError}</p>}
      {error && <p className="error">{error}</p>}
      {!result ? (
        <div className="empty">
          <p>Drop an annotation bundle (exported from ontology-ui's CLI page) and one or more <code>display current-configuration</code> dumps.</p>
          <p className="muted">Everything runs in this browser. Nothing is uploaded and no dump is stored.</p>
        </div>
      ) : (
        <div className="main">
          <section className="center">
            <div className="toolbar">
              <div className="filters">
                {FILTERS.map(([k, label]) => (
                  <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
                ))}
              </div>
              <input type="search" placeholder="Search lines" value={search} onChange={e => setSearch(e.target.value)} />
              <ExportBar result={result} dumpName={dump.name} />
            </div>
            {result.warnings.length > 0 && <ul className="warnings">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
            <DumpView result={result} filter={filter} search={search} selected={selected} onSelect={setSelected} />
          </section>
          <aside className="side">
            {line
              ? <LineDetail line={line} result={result} bundle={bundle.loaded} onClose={() => setSelected(null)} />
              : <SummaryPanel result={result} onSelectLine={setSelected} />}
          </aside>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Replace `src/App.css`**

```css
:root {
  --bg: #f7f8fa; --panel: #ffffff; --fg: #1d2330; --muted: #6b7280; --line: #e3e6ec;
  --accent: #3b6fd1; --exact: #2f7d4f; --equiv: #b7791f; --enc: #4a6fa5; --error: #b42318;
  --sel: #e8effc; --chip: #eef1f6;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151c; --panel: #1a1e27; --fg: #e5e7eb; --muted: #9ca3af; --line: #2a2f3a;
    --accent: #7aa2f7; --exact: #4fbf7f; --equiv: #e0a84a; --enc: #7f9fd0; --error: #f97066;
    --sel: #243049; --chip: #252b37;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
button { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button.on { border-color: var(--accent); color: var(--accent); }
button.link { border: 0; padding: 0; background: none; color: var(--accent); text-align: left; }
input[type="search"], textarea { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.muted { color: var(--muted); }
.warn { color: var(--equiv); }
.error { color: var(--error); margin: 8px 16px; }
.pad { padding: 8px 16px; }

.app { display: flex; flex-direction: column; height: 100vh; }
.inputs { background: var(--panel); border-bottom: 1px solid var(--line); padding: 8px 16px; }
.inputs-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.drop { display: flex; flex-direction: column; min-width: 180px; padding: 6px 12px; border: 1px dashed var(--line); border-radius: 8px; cursor: pointer; }
.drop.over { border-color: var(--accent); background: var(--sel); }
.drop-label { font-weight: 600; }
.drop-hint { font-size: 12px; color: var(--muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toggle { display: flex; align-items: center; gap: 4px; }
.local-note { margin-left: auto; font-size: 12px; color: var(--muted); }
.paste { display: flex; gap: 8px; align-items: flex-start; margin-top: 8px; }
.paste textarea { flex: 1; }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.tab { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.tab button { border: 0; border-radius: 0; }
.tab.active { border-color: var(--accent); }
.tab .close { color: var(--muted); padding: 4px 8px; }

.empty { margin: 48px auto; max-width: 560px; padding: 0 16px; text-align: center; }
.main { display: flex; flex: 1; min-height: 0; }
.center { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--line); }
.filters { display: flex; gap: 4px; }
.exports { display: flex; gap: 4px; align-items: center; margin-left: auto; }
.warnings { margin: 0; padding: 6px 16px 6px 32px; color: var(--equiv); border-bottom: 1px solid var(--line); font-size: 13px; }

.dump { flex: 1; overflow: auto; padding: 4px 0; font-size: 12.5px; }
.ln { display: flex; align-items: baseline; gap: 8px; padding: 0 16px 0 8px; border-left: 3px solid transparent; cursor: pointer; white-space: pre; }
.ln:hover { background: var(--sel); }
.ln.sel { background: var(--sel); }
.ln .n { color: var(--muted); min-width: 3.5em; text-align: right; user-select: none; font-family: ui-monospace, monospace; }
.ln-header code, .ln-separator code, .ln-end code { color: var(--muted); }
.ln.via-exact { border-left-color: var(--exact); }
.ln.via-equivalent { border-left: 3px dashed var(--equiv); }
.ln.via-enclosing, .ln.via-all { border-left: 3px dotted var(--enc); }
.chip { font: 11px system-ui, sans-serif; background: var(--chip); border-radius: 10px; padding: 0 8px; border: 1px solid transparent; }
.chip.via-exact { border-color: var(--exact); }
.chip.via-equivalent { border-color: var(--equiv); border-style: dashed; }
.chip.via-enclosing, .chip.via-all { border-color: var(--enc); border-style: dotted; }

.side { width: 400px; flex-shrink: 0; overflow: auto; background: var(--panel); border-left: 1px solid var(--line); padding: 12px 16px; }
.side h2 { font-size: 16px; margin: 0 0 4px; }
.side h3 { font-size: 14px; margin: 16px 0 6px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; }
.detail-line { background: var(--chip); padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; }
.match { border-top: 1px solid var(--line); margin-top: 12px; }
.badge { font-size: 11px; font-weight: normal; border-radius: 10px; padding: 0 8px; background: var(--chip); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 6px 0; }
dt { color: var(--muted); }
dd { margin: 0; }
.params div { display: contents; }
.syntax { display: block; background: var(--chip); padding: 2px 6px; border-radius: 4px; margin: 4px 0; white-space: pre-wrap; }
.stats { display: flex; gap: 8px; margin: 8px 0; }
.stats div { flex: 1; display: flex; flex-direction: column; background: var(--chip); border-radius: 8px; padding: 6px 8px; }
.stats strong { font-size: 18px; }
.stats span { font-size: 12px; color: var(--muted); }
.instances { list-style: none; padding: 0; margin: 0; }
.instances li { padding: 2px 0; }
details { margin: 6px 0; }

@media (max-width: 820px) {
  .main { flex-direction: column; }
  .side { width: auto; border-left: 0; border-top: 1px solid var(--line); max-height: 45vh; }
  .local-note { margin-left: 0; }
}
```

- [ ] **Step 8: Build, lint and test**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && npm test && npm run lint && npm run build && grep -c "connect-src 'none'" dist/index.html && ! grep -rlE "fetch\(|XMLHttpRequest" src`
Expected: tests pass; lint prints no errors; the build succeeds; the grep prints `1`; the last command finds nothing.

- [ ] **Step 9: Smoke-test the built page (not committed)**

Start the preview in the background: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && npm run preview -- --port 4174 --strictPort`

Write `/tmp/claude-1000/-mnt-c-code-ontology-ui/44e50c5b-1c4c-4b4e-bcd1-6ed45f65690d/scratchpad/smoke.mjs`, using the Playwright that ontology-ui already has:

```js
import { createRequire } from 'node:module';
const require = createRequire('/mnt/c/code/ontology-ui/package.json');
const { chromium } = require('playwright');

const fx = '/mnt/c/code/cli-annotator/test/fixtures/';
const shot = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
const foreign = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', r => { if (!r.url().startsWith('http://localhost:4174/')) foreign.push(r.url()); });

await page.goto('http://localhost:4174/');
await page.setInputFiles('input[data-input="bundle"]', fx + 'bundle-v2.json');
await page.setInputFiles('input[data-input="dumps"]', fx + 'device-excerpt.txt');
await page.waitForSelector('#L23.via-equivalent');
console.log('lines', await page.locator('.ln').count());
console.log('line 13 redacted', (await page.textContent('#L13')).includes('****'));
await page.click('#L23');
console.log('detail shows isis enable', (await page.textContent('.side')).includes('isis enable'));
await page.click('text=Summary');
console.log('instances listed', await page.locator('.instances li').count());
await page.screenshot({ path: shot });
console.log('errors', errors, 'foreign requests', foreign);
await browser.close();
```

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && node /tmp/claude-1000/-mnt-c-code-ontology-ui/44e50c5b-1c4c-4b4e-bcd1-6ed45f65690d/scratchpad/smoke.mjs /tmp/claude-1000/-mnt-c-code-ontology-ui/44e50c5b-1c4c-4b4e-bcd1-6ed45f65690d/scratchpad/smoke.png`
Expected:

```
lines 33
line 13 redacted true
detail shows isis enable true
instances listed 10
errors [] foreign requests []
```

Look at the screenshot to check the layout, then stop the preview server.

- [ ] **Step 10: Commit**

```bash
git -C /mnt/c/code/cli-annotator add package.json src/App.jsx src/App.css src/files.js src/lastBundle.js src/browser.test.js src/components
git -C /mnt/c/code/cli-annotator commit -m "Web page: inputs, annotated dump, line detail, summary and exports" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```

---

### Task 13: Real-dump check script and docs

**Files:**
- Create: `scripts/check-dumps.mjs`, `scripts/check-dumps.test.mjs`, `README.md`, `CLAUDE.md`
- Modify: `package.json` (`"test"` also runs `scripts/check-dumps.test.mjs`)

**Interfaces:**
- Consumes: `loadBundle` (Task 2), `annotate` and `Result` (Task 10).
- Produces: `node scripts/check-dumps.mjs [--no-equivalence] <bundle.json> <dump…>`. It always redacts. For each dump it prints only counts, keywords, mapping titles and instance names, never a line of the dump. Exit status: 0 on success, 2 on a usage error.

- [ ] **Step 1: Write the failing test**

`scripts/check-dumps.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-dumps.mjs', import.meta.url));
const fx = name => fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('prints coverage, keywords and instance names for each dump', () => {
  const r = run(fx('bundle-v2.json'), fx('device-excerpt.txt'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^device-excerpt\.txt$/m);
  assert.match(r.stdout, /mappings found 12\/12; config lines matched 15\/22; blocks unresolved 1\/7/);
  assert.match(r.stdout, /unresolved blocks by keyword: aaa ×1/);
  assert.match(r.stdout, /unmatched lines by keyword: .*local-user ×1/);
  assert.match(r.stdout, /GigabitEthernet0\/2\/1\.111/);
});

test('never prints a line of the dump', () => {
  const { stdout } = run(fx('bundle-v2.json'), fx('device-excerpt.txt'));
  for (const s of ['FAKESECRET', 'irreversible-cipher', '10.0.0.1', '255.255.255.0', '1.1.1.207', 'vpn-target']) {
    assert.ok(!stdout.includes(s), `output contains ${s}`);
  }
});

test('--no-equivalence matches only the exact views', () => {
  const r = run('--no-equivalence', fx('bundle-v2.json'), fx('device-excerpt.txt'));
  assert.match(r.stdout, /config lines matched 10\/22/);
});

test('a missing argument is a usage error', () => {
  const r = run(fx('bundle-v2.json'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/check-dumps\.mjs/);
});
```

In `package.json`, set `"test": "node --test src/lib/ src/browser.test.js scripts/check-dumps.test.mjs"`.

`vpn-target` is on purpose: it is a matched line's keyword, and only *unmatched* keywords are printed.

- [ ] **Step 2: Run it and see it fail**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && node --test /mnt/c/code/cli-annotator/scripts/check-dumps.test.mjs`
Expected: FAIL. The script does not exist, so the first test sees exit status 1.

- [ ] **Step 3: Implement the script**

`scripts/check-dumps.mjs`:

```js
// Coverage check for real configuration dumps. Real dumps hold secrets, so this
// prints counts, keywords, mapping titles and instance names only, never a line
// of the dump. Redaction is always on.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadBundle } from '../src/lib/bundle.js';
import { annotate } from '../src/lib/annotate.js';

const args = process.argv.slice(2);
const equivalence = !args.includes('--no-equivalence');
const [bundlePath, ...dumpPaths] = args.filter(a => !a.startsWith('--'));
if (!bundlePath || !dumpPaths.length) {
  console.error('usage: node scripts/check-dumps.mjs [--no-equivalence] <bundle.json> <dump…>');
  process.exit(2);
}

// The leading keyword of a line; "undo" keeps the keyword after it.
function keyword(text) {
  const [a = '', b = ''] = text.trim().split(/\s+/);
  return a.toLowerCase() === 'undo' && b ? `undo ${b}` : a;
}

function tally(keys) {
  const m = new Map();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
}

const list = pairs => pairs.map(([k, n]) => `${k} ×${n}`).join(', ') || '—';

const bundle = loadBundle(readFileSync(bundlePath, 'utf8'));
for (const path of dumpPaths) {
  const r = annotate(readFileSync(path, 'utf8'), bundle, { equivalence, redact: true });
  const c = r.coverage;
  const textOf = new Map(r.lines.map(l => [l.n, l.text]));
  const notFound = [...new Set(bundle.mappings.filter(m => !c.byMapping[m.id]).map(m => m.title || m.id))];

  console.log(basename(path));
  console.log(`  device ${r.device.sysname ?? '?'}, software ${r.device.softwareVersion ?? '?'}`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  console.log(`  mappings found ${c.mappings.found}/${c.mappings.total}; config lines matched ${c.lines.matched}/${c.lines.config}; blocks unresolved ${c.blocks.unresolved.length}/${c.blocks.total}`);
  console.log(`  mappings not found: ${notFound.join(', ') || '—'}`);
  console.log(`  matches by via: ${list(tally(r.lines.flatMap(l => l.matches.map(m => m.via))))}`);
  console.log(`  instances ${r.instances.length}: ${list(tally(r.instances.map(i => i.dte.entity)))}`);
  for (const i of r.instances) {
    console.log(`    ${i.dte.entity} ${i.name} [${i.topology.join(', ')}]${i.via === 'exact' ? '' : ` (${i.via})`}`);
  }
  console.log(`  unresolved blocks by keyword: ${list(tally(c.blocks.unresolved.map(b => keyword(b.text))))}`);
  console.log(`  unmatched lines by keyword: ${list(tally(r.unmatched.map(n => keyword(textOf.get(n)))).slice(0, 25))}`);
}
```

Instance names are key values, interface names or opener text, all read from redacted lines, so a secret cannot appear in them.

- [ ] **Step 4: Run the tests and see them pass**

Run: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd /mnt/c/code/cli-annotator && npm test && npm run lint`
Expected: every test passes and lint prints no errors.

- [ ] **Step 5: Run it on the real dumps**

Write the output to the scratchpad. Do not paste the whole output into the conversation without first checking it for secrets:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
D="/home/mike/c/code/ontology-ui/Sample Ontologies/cli/dumps"
node /mnt/c/code/cli-annotator/scripts/check-dumps.mjs \
  /tmp/claude-1000/-mnt-c-code-ontology-ui/44e50c5b-1c4c-4b4e-bcd1-6ed45f65690d/scratchpad/topo-cli-bundle.json \
  "$D/device_207.txt" "$D/device_208.txt" "$D/device_209.txt" "$D/device_210.txt" \
  > /tmp/claude-1000/-mnt-c-code-ontology-ui/44e50c5b-1c4c-4b4e-bcd1-6ed45f65690d/scratchpad/check-v1.txt
grep -cE '%\^%#|cipher|\$1[a-z]\$|public-key-code|community' /tmp/claude-1000/-mnt-c-code-ontology-ui/44e50c5b-1c4c-4b4e-bcd1-6ed45f65690d/scratchpad/check-v1.txt
```

Expected:
- The grep prints `0`.
- Each dump shows the v1 warning ("interface equivalence is limited…") and the version-mismatch warning (dumps V800R025C10SPC500, bundle V800R022C00SPC600).
- At least one interface instance per dump.
- No exception.

The bundle is the scratch v1 export. Once the user exports a v2 bundle from ontology-ui's CLI page (Task 1 code, after they deploy it), rerun with it to `/tmp/claude-1000/-mnt-c-code-ontology-ui/44e50c5b-1c4c-4b4e-bcd1-6ed45f65690d/scratchpad/check-v2.txt`. With v2, GigabitEthernet and 25GE interfaces should resolve through `equivalent` views, so `matches by via` lists `equivalent`. Report both runs' coverage lines to the user, and say which mappings were not found in any dump.

- [ ] **Step 6: Write `README.md`**

````markdown
# CLI annotator

Annotates a Huawei `display current-configuration` dump with the DTE and topology meaning of each line. It uses the
annotation bundle that ontology-ui exports from its CLI page (**Annotation bundle (JSON)**).

Everything runs in the browser. Nothing is uploaded, the built page forbids network connections
(`connect-src 'none'`), and dumps are never stored. Only the last bundle's file name is remembered.

## Use

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/, open from any web server
```

1. Drop the bundle and one or more dumps on the page, or paste a dump.
2. Matched lines get a bar and a chip:
   - solid bar: matched in the mapping's own view
   - dashed bar: matched in an equivalent interface view, e.g. a GigabitEthernet line using a 100GE mapping
   - dotted bar: matched through an enclosing block, or a mapping for all views
3. Click a line for its command, syntax, mappings and topology entities. With no line selected, the side panel
   shows the instances, coverage, warnings and gaps in the bundle.
4. Export an HTML report, JSON instances or annotated text.

**Interface equivalence** and **Redact secrets** are on by default. With redaction off, the exports carry the
dump's passwords and keys.

## Real dumps

Real dumps contain secrets, so keep them out of this repository (`dumps/` is ignored). To check coverage
from the terminal without printing any dump line:

```bash
node scripts/check-dumps.mjs [--no-equivalence] <bundle.json> <dump…>
```

## Development

```bash
npm test           # node --test: src/lib/, src/browser.test.js, scripts/check-dumps.test.mjs
npm run lint
```

The design is in `docs/superpowers/specs/2026-10-21-cli-annotator-design.md`.
````

- [ ] **Step 7: Write `CLAUDE.md`**

````markdown
# CLAUDE.md

## Commands

Node is managed by nvm. Source it in every non-interactive shell:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm run dev            # Vite → http://localhost:5173 (watch disabled on WSL; restart to pick up changes)
npm run build          # dist/, with a CSP meta (connect-src 'none') injected by vite.config.js
npm test               # node --test
npm run lint
node scripts/check-dumps.mjs <bundle.json> <dump…>   # coverage for real dumps; prints no dump lines
```

## Rules

- **Client-side only.** No `fetch`/XHR in `src/`. Dumps and bundles stay in React state. localStorage holds only
  `cli-annotator.lastBundle` ({name, generatedAt}).
- **Real dumps contain secrets** (cipher passwords, `%^%#…%^%#` strings, RSA keys, SNMP communities). Never copy
  them into this repo, and never print their lines in a terminal, test or script. Print counts and keywords.
- Nothing in the pipeline throws on dump input. Version and device mismatches are warnings. Only an invalid
  bundle throws.

## Layout

```
src/lib/          pure pipeline, no React or DOM (each module has a *.test.js)
  bundle.js         loadBundle: format check (v1/v2), command and view mapping lookups
  parseConfig.js    lines (n, text, indent, kind) and blocks (opener, parent, depth, children); CRLF/BOM
  syntax.js         compileSyntax / compileCommand: catalogue syntax → matcher; unknown notation → prefixOnly
  interfaces.js     interface types and shapes (main / sub / l2sub) from the bundle's viewIndex
  resolveViews.js   candidate views per block: exact, equivalent (interface shape), nested scope, owner
  matchLines.js     line × mapping matches: via exact | equivalent | enclosing | all
  buildInstances.js one instance per (owner block, DTE entity); naming; topology narrowing
  redact.js         masks secrets, keeping the keyword (runs before matching)
  annotate.js       annotate(text, bundle, {equivalence, redact}) → Result
  export/           json.js (instances), text.js (annotated text), html.js (self-contained report)
src/              App.jsx (state), components/, files.js (read/download), lastBundle.js, App.css
test/fixtures/    bundle-v2.json (hand-made bundle), device-excerpt.txt (secret-free excerpt)
scripts/          check-dumps.mjs (+ test)
```

The bundle format is documented in ontology-ui: `docs/topo-cli-bundle.md`.
````

- [ ] **Step 8: Commit**

```bash
git -C /mnt/c/code/cli-annotator add package.json scripts/check-dumps.mjs scripts/check-dumps.test.mjs README.md CLAUDE.md
git -C /mnt/c/code/cli-annotator commit -m "Real-dump check script, README and CLAUDE.md" \
  -m $'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012nzUuDpqJwVLy1uEQ3aULo'
```
