import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSyntax, compileCommand } from './syntax.js';

test('keywords match case-insensitively as whole tokens; a choice takes the first option on a tie', () => {
  const s = compileSyntax('ip address <ip-address> { <mask> | <mask-length> } [ sub ]');
  assert.equal(s.ok, true);
  assert.equal(s.first, 'ip');
  assert.deepEqual(s.match('IP Address 10.0.0.1 255.255.255.0'),
    { params: { 'ip-address': '10.0.0.1', mask: '255.255.255.0' }, literals: 2 });
  assert.equal(s.match('ip addresses 10.0.0.1 24'), null);
});

test('an optional keyword counts as a literal when present; extra tokens fail the match', () => {
  const s = compileSyntax('ip address <ip-address> { <mask> | <mask-length> } [ sub ]');
  assert.equal(s.match('ip address 1.1.1.1 24 sub').literals, 3);
  assert.equal(s.match('ip address 1.1.1.1 24 sub extra'), null);
});

test('&<1-n> repeats a value up to n times and captures the first', () => {
  const s = compileSyntax('vpn-target <vpn-target> &<1-8> [ both | export-extcommunity | import-extcommunity ]');
  assert.deepEqual(s.match('vpn-target 100:1 200:2 export-extcommunity'),
    { params: { 'vpn-target': '100:1' }, literals: 2 });
  const nine = Array.from({ length: 9 }, (_, k) => `${k}:1`).join(' ');
  assert.equal(s.match(`vpn-target ${nine}`), null);
});

test('[ … ] * allows zero or more, { … } * one or more', () => {
  const opt = compileSyntax('mtu <mtu> [ spread | test ] *');
  assert.deepEqual(opt.match('mtu 1500'), { params: { mtu: '1500' }, literals: 1 });
  assert.equal(opt.match('mtu 1500 test spread').literals, 3);
  assert.equal(opt.match('mtu 1500 foo'), null);
  const req = compileSyntax('x { a | b } *');
  assert.equal(req.match('x'), null);
  assert.equal(req.match('x b a').literals, 3);
});

test('composite tokens split on their literal pieces: lazy groups, greedy last group', () => {
  const s = compileSyntax('x <a>.<b>');
  assert.deepEqual(s.match('x 1.2.3').params, { a: '1', b: '2.3' });
});

test('a keyword and its value may be joined in one token when the value starts with a digit', () => {
  const sub = compileSyntax('interface GigabitEthernet <interface-number>.<sub-number>');
  const want = { 'interface-number': '0/2/1', 'sub-number': '111' };
  assert.deepEqual(sub.match('interface GigabitEthernet0/2/1.111').params, want);
  assert.deepEqual(sub.match('interface GigabitEthernet 0/2/1.111').params, want);
  assert.equal(sub.match('interface GigabitEthernet0/2/1.111').literals, 2);
  const lo = compileSyntax('interface LoopBack <loopback-number>');
  assert.deepEqual(lo.match('interface LoopBack0').params, { 'loopback-number': '0' });
  assert.equal(lo.match('interface LoopBackX'), null);
});

test('notation that cannot be parsed falls back to its leading keywords', () => {
  const s = compileSyntax('foo bar [ <x>');
  assert.equal(s.ok, false);
  assert.deepEqual(s.match('foo bar 1'), { params: {}, literals: 2, prefixOnly: true });
  assert.equal(s.match('foo baz'), null);
});

test('compileCommand skips undo forms and picks the form with the most literals', () => {
  const l2vc = compileCommand({ syntax: [
    'mpls l2vc <ip-address> <vc-id> [ tunnel-policy <policy-name> ] [ control-word | no-control-word ] [ raw | tagged ]',
    'mpls l2vc instance-name <instance-name> <ip-address> <vc-id> [ control-word | no-control-word ] [ raw | tagged ]',
    'undo mpls l2vc',
  ] });
  const r = l2vc.match('mpls l2vc instance-name GigabitEthernet0/2/1.111 192.0.2.9 7 no-control-word raw');
  assert.equal(r.params['vc-id'], '7');
  assert.equal(r.prefixOnly, false);
  assert.match(r.syntax, /instance-name/);
  assert.equal(compileCommand({ syntax: ['undo isis <process-id>'] }).match('undo isis 1'), null);
});

test('compileCommand prefers a full match over a prefix-only one', () => {
  const c = compileCommand({ syntax: ['isis [ broken', 'isis <process-id>'] });
  assert.deepEqual(c.match('isis 7'), { params: { 'process-id': '7' }, literals: 1, prefixOnly: false, syntax: 'isis <process-id>' });
});

test('a pathological starred syntax gives up within the step budget', () => {
  const s = compileSyntax('a [ <p> | <q> | b ] * [ <r> | <s> ] * c');
  const line = 'a' + ' x'.repeat(40) + ' d';
  const t0 = Date.now();
  assert.equal(s.match(line), null);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test('an extremely long line returns null instead of throwing', () => {
  const s = compileSyntax('a [ <p> ] *');
  assert.equal(s.match('a' + ' x'.repeat(8000)), null);
  assert.deepEqual(s.match('a x y'), { params: { p: 'x' }, literals: 1 });
  assert.equal(compileCommand({ syntax: ['a [ <p> ] *'] }).match('a' + ' x'.repeat(8000)), null);
});
