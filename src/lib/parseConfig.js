// Splits a `display current-configuration` dump into numbered lines and nested
// blocks. Never throws: anything it cannot place is still a numbered line.
export function parseConfig(text) {
  const raw = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  if (raw.length && raw[raw.length - 1] === '') raw.pop();

  const lines = [];
  const blocks = [];
  let softwareVersion = null;
  let sysname = null;
  let ended = false;
  let stack = [];   // open blocks, innermost last: {id, indent}
  let last = null;  // previous config line, a candidate opener

  const open = (line) => {
    const parent = line.block;
    const block = {
      id: blocks.length, opener: line.n, text: line.text.trim(), parent,
      depth: parent === null ? 0 : blocks[parent].depth + 1, children: [],
    };
    blocks.push(block);
    line.opens = block.id;
    stack.push({ id: block.id, indent: line.indent });
  };

  raw.forEach((t, i) => {
    const body = t.trim();
    const indent = t.length - t.trimStart().length;
    const line = { n: i + 1, text: t, indent, kind: 'config', block: null, opens: null };
    lines.push(line);

    if (ended) { line.kind = 'end'; return; }
    if (!body) { line.kind = 'blank'; return; }
    if (indent === 0 && body.startsWith('!')) {
      line.kind = 'header';
      softwareVersion ??= /^!Software Version (\S+)/.exec(body)?.[1] ?? null;
      return;
    }
    if (body === '#') {
      line.kind = 'separator';
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      last = null;
      return;
    }
    if (indent === 0 && body === 'return') {
      line.kind = 'end';
      ended = true;
      stack = [];
      return;
    }

    if (last && indent > last.indent && last.opens === null) open(last);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    line.block = stack.length ? stack[stack.length - 1].id : null;
    if (line.block !== null) blocks[line.block].children.push(line.n);
    if (indent === 0) {
      open(line);
      sysname ??= /^sysname\s+(\S+)/.exec(body)?.[1] ?? null;
    }
    last = line;
  });

  return { softwareVersion, sysname, lines, blocks };
}
