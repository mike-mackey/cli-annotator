// Coverage check for real configuration dumps. Real dumps hold secrets, so this
// prints counts, keywords, mapping titles and instance names only, never a line
// of the dump. Redaction is always on.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadBundle } from '../src/lib/bundle.js';
import { annotate } from '../src/lib/annotate.js';

const USAGE = 'usage: node scripts/check-dumps.mjs [--no-equivalence] <bundle.json> <dump…>';
const FLAGS = new Set(['--no-equivalence']);
const args = process.argv.slice(2);
const unknown = args.filter(a => a.startsWith('--') && !FLAGS.has(a));
if (unknown.length) {
  console.error(`unknown option: ${unknown.join(', ')}`);
  console.error(USAGE);
  process.exit(2);
}
const equivalence = !args.includes('--no-equivalence');
const [bundlePath, ...dumpPaths] = args.filter(a => !a.startsWith('--'));
if (!bundlePath || !dumpPaths.length) {
  console.error(USAGE);
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
