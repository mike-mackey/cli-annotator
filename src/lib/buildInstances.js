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

    const own = topologyOf(g.dteId);
    const cands = own?.length ? own : (ms[0].mapping.topology ?? []).map(entity => ({ entity, schema: null }));
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
