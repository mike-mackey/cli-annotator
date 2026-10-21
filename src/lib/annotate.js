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
    // Redact before anything is matched, so captured values never hold a secret.
    const lines = redactLines(parsed.lines);
    parsed = { ...parsed, lines, blocks: parsed.blocks.map(b => ({ ...b, text: lines[b.opener - 1].text.trim() })) };
  }
  const views = resolveViews(parsed.blocks, loaded, { equivalence });
  const matches = matchLines(parsed, views, loaded);
  const instances = buildInstances(matches, parsed, views, loaded);

  const instanceOf = new Map();
  for (const i of instances) for (const m of i.matches) instanceOf.set(`${m.n}|${m.mappingId}|${m.via}`, i.id);
  const byLine = new Map();
  for (const m of matches) {
    if (!byLine.has(m.n)) byLine.set(m.n, []);
    byLine.get(m.n).push({
      mappingId: m.mapping.id, title: m.mapping.title, kind: m.kind, featureId: m.mapping.featureId,
      view: m.view, via: m.via, realView: m.realView, dte: m.mapping.dte, relation: m.mapping.relation,
      cliParameter: m.mapping.cliParameter, value: m.value, params: m.params, prefixOnly: m.prefixOnly,
      instance: instanceOf.get(`${m.n}|${m.mapping.id}|${m.via}`) ?? null,
    });
  }

  const lines = parsed.lines.map(l => {
    const own = l.opens ?? l.block;
    return {
      n: l.n, text: l.text, kind: l.kind, indent: l.indent, block: l.block, opens: l.opens, redacted: Boolean(l.redacted),
      views: own === null || own === undefined ? [] : views[own].candidates, matches: byLine.get(l.n) ?? [],
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
