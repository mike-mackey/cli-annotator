// Interface views in the catalogue: which interface type and shape each view's
// entry command opens, and how a dump's "interface 25GE0/2/8.3" splits up.
const ENTRY_RE = /^interface\s+([A-Za-z0-9][\w-]*)\s+<[^<>]+>(\.<[^<>]+>)?(\s+mode\s+l2)?\s*$/i;

export function shapeOf(entryCommand) {
  const m = ENTRY_RE.exec(entryCommand ?? '');
  if (!m) return null;
  if (m[3] && !m[2]) return null;  // "mode l2" only follows a sub-interface
  return { type: m[1], shape: m[2] ? (m[3] ? 'l2sub' : 'sub') : 'main' };
}

// Interface types that can stand in for each other: physical Ethernet ports
// (GigabitEthernet, XGigabitEthernet, GE, 10GE, 100GE, Ethernet, …) form one
// class; every other type (Eth-Trunk, Tunnel, LoopBack, Vlanif, NULL, …) is a
// class of its own.
const ETHERNET_RE = /^(?:GigabitEthernet|XGigabitEthernet|GE|\d+GE|Ethernet)$/i;

export function interfaceClass(type) {
  const t = String(type ?? '');
  return ETHERNET_RE.test(t) ? 'ethernet' : `type:${t.toLowerCase()}`;
}

export function buildInterfaceIndex(viewIndex) {
  const views = [];
  const types = new Map();  // lowercased → first spelling seen
  for (const [view, entry] of Object.entries(viewIndex ?? {})) {
    const s = shapeOf(entry?.entryCommand);
    if (!s) continue;
    if (!types.has(s.type.toLowerCase())) types.set(s.type.toLowerCase(), s.type);
    views.push({ view, type: types.get(s.type.toLowerCase()), shape: s.shape });
  }
  return { views, types: [...types.values()].sort((a, b) => b.length - a.length) };
}

const ID_RE = /^ ?(\d[\d/:]*)(?:\.(\d+))?(\s+mode\s+l2)?$/i;

export function parseInterfaceOpener(text, types) {
  const m = /^interface\s+(.+?)\s*$/i.exec(String(text).trim());
  if (!m) return null;
  const rest = m[1];
  for (const type of types) {
    if (!rest.toLowerCase().startsWith(type.toLowerCase())) continue;
    const id = ID_RE.exec(rest.slice(type.length));
    if (!id) continue;
    const [, number, sub = null, l2] = id;
    if (l2 && !sub) continue;  // "mode l2" only follows a sub-interface
    const name = rest.slice(0, type.length) + number + (sub ? `.${sub}` : '');
    return { type, number, sub, name, shape: sub ? (l2 ? 'l2sub' : 'sub') : 'main' };
  }
  return null;
}
