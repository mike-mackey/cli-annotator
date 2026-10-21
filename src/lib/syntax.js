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
