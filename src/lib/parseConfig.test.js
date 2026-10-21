import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from './parseConfig.js';

const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const line = (p, n) => p.lines[n - 1];
const blockOf = (p, n) => p.blocks[line(p, n).block];

test('reads the header and sysname and numbers every line', () => {
  const p = parseConfig(excerpt);
  assert.equal(p.softwareVersion, 'V800R025C10SPC500');
  assert.equal(p.sysname, 'PE207');
  assert.equal(p.lines.length, 33);
  assert.deepEqual([1, 2, 3, 33].map(n => line(p, n).kind), ['header', 'header', 'separator', 'end']);
  assert.equal(p.lines.filter(l => l.kind === 'config').length, 22);
});

test('top-level lines open blocks and indentation nests them', () => {
  const p = parseConfig(excerpt);
  const vpn = p.blocks[line(p, 6).opens];
  const fam = p.blocks[line(p, 7).opens];
  assert.equal(vpn.text, 'ip vpn-instance L3VPN_A');
  assert.equal(vpn.parent, null);
  assert.equal(fam.parent, vpn.id);
  assert.equal(fam.depth, 1);
  assert.deepEqual(fam.children, [8, 9, 10]);
  assert.deepEqual(vpn.children, [7]);
  assert.equal(line(p, 7).block, vpn.id);
  assert.equal(blockOf(p, 23).text, 'interface GigabitEthernet0/2/1');
  assert.equal(line(p, 4).opens !== null, true);
  assert.deepEqual(p.blocks[line(p, 4).opens].children, []);
});

test('a lone # at child depth closes the sub-block', () => {
  const p = parseConfig('bgp 100\n ipv4-family unicast\n  undo synchronization\n #\n peer 1.1.1.1 enable\n#\n');
  assert.equal(p.blocks.length, 2);
  assert.equal(line(p, 4).kind, 'separator');
  assert.equal(line(p, 5).block, line(p, 1).opens);
  assert.equal(line(p, 5).opens, null);
});

test('a dump saved with CRLF endings and a BOM parses like the LF original', () => {
  const lf = parseConfig(excerpt);
  const crlf = parseConfig('﻿' + excerpt.replace(/\n/g, '\r\n'));
  assert.equal(crlf.softwareVersion, 'V800R025C10SPC500');
  assert.equal(crlf.lines.length, 33);
  assert.equal(crlf.lines.some(l => l.text.includes('\r') || l.text.includes('﻿')), false);
  assert.deepEqual(crlf.lines.map(l => [l.kind, l.block, l.opens]), lf.lines.map(l => [l.kind, l.block, l.opens]));
  assert.deepEqual(crlf.blocks, lf.blocks);
});

test('a dump without a header still parses', () => {
  const p = parseConfig('sysname X\n#\nreturn');
  assert.equal(p.softwareVersion, null);
  assert.equal(p.sysname, 'X');
  assert.equal(p.lines.length, 3);
});
