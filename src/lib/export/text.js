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
    const pad = l.text.slice(0, l.indent);
    for (const i of heads.get(l.n) ?? []) out.push(`${pad}! @ ${i.dte.entity} ${i.name}`);
    for (const m of l.matches) out.push(`${pad}! @ ${matchNote(m, byId)}`);
  }
  return out.join('\n') + '\n';
}
