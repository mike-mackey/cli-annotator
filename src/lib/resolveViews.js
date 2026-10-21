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
  const entry = exact.length ? bundle.viewIndex[exact[0]]?.entryCommand : null;
  const params = (entry && compileSyntax(entry).match(text)?.params)
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
