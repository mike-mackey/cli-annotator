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
