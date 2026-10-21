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
  resolveViews.js   candidate views per block: exact, equivalent (same interface shape and class: Ethernet types only with each other), nested scope, owner
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
