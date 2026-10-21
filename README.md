# CLI annotator

Annotates a Huawei `display current-configuration` dump with the DTE and topology meaning of each line. It uses the
annotation bundle that ontology-ui exports from its CLI page (**Annotation bundle (JSON)**).

Everything runs in the browser. Nothing is uploaded, the built page forbids network connections
(`connect-src 'none'`), and dumps are never stored. Only the last bundle's file name and generation time
(`generatedAt`) are remembered, in localStorage.

The Content Security Policy is injected at build time, so it applies to the built page (`npm run build`,
`dist/`) only, not to `npm run dev`.

## Use

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/, open from any web server
```

1. Drop the bundle and one or more dumps on the page, or paste a dump.
2. Matched lines get a bar and a chip:
   - solid bar: matched in the mapping's own view
   - dashed bar: matched in an equivalent interface view, e.g. a GigabitEthernet line using a 100GE mapping.
     Only physical Ethernet types (GigabitEthernet, XGigabitEthernet, GE, 10GE, 100GE, Ethernet, …) stand in
     for each other; Eth-Trunk, Tunnel, LoopBack, Vlanif and other types match only their own views.
   - dotted bar: matched through an enclosing block, or a mapping for all views
3. Click a line for its command, syntax, mappings and topology entities. With no line selected, the side panel
   shows the instances, coverage, warnings and gaps in the bundle.
4. Export an HTML report, JSON instances or annotated text. The annotated text has LF line endings, whatever
   the dump used.

**Interface equivalence** and **Redact secrets** are on by default. With redaction off, the exports carry the
dump's passwords and keys. Redaction masks the value after password / cipher / simple / plain keywords,
`%^%#…%^%#` strings (an unterminated one is masked through the following lines until it closes), `$1x$`
hashes, authentication-mode keys, md5-password, (pre-)shared-key, key-string, SNMP communities and
security names, and public-key-code bodies.

View-family mappings in the bundle are not applied: the bundle names the family but not its member views.
They are dropped with a warning.

Nothing in the pipeline throws on dump input: version and device mismatches are warnings, and any line the
parser cannot place is still numbered and shown. Only an invalid bundle is an error.

## Real dumps

Real dumps contain secrets, so keep them out of this repository (`dumps/` is ignored). To check coverage
from the terminal without printing any dump line:

```bash
npm run check-dumps -- [--no-equivalence] <bundle.json> <dump…>
# or: node scripts/check-dumps.mjs [--no-equivalence] <bundle.json> <dump…>
```

It prints counts, mapping titles, leading keywords and instance names, never a whole dump line. An unknown
`--` option is a usage error (exit 2). The keywords and instance names come from the redacted but otherwise
unfiltered dump, so the device's sysname, VRF names, interface names and similar identifiers can appear in
the output; review it before sharing.

## Development

```bash
npm test           # node --test: src/lib/, src/browser.test.js, scripts/check-dumps.test.mjs
npm run lint
```

The design is in `docs/superpowers/specs/2026-10-21-cli-annotator-design.md`.
