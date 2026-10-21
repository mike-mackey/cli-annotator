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
