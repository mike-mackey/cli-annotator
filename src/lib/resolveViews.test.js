import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { parseConfig } from './parseConfig.js';
import { resolveViews, mappedViews } from './resolveViews.js';
import { interfaceClass } from './interfaces.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const bundle = loadBundle(raw);
const parsed = parseConfig(excerpt);
const opened = (views, p, n) => views[p.lines[n - 1].opens];

test('mappedViews collects mapping views and mapped commands\' parent views', () => {
  assert.deepEqual([...mappedViews(bundle)].sort(), [
    '100ge interface view', '100ge sub-interface view', 'ge interface view', 'ge sub-interface view',
    'is-is view', 'loopback interface view', 'system view', 'vpn instance view',
  ]);
});

test('an interface resolves exactly to its own view and equivalently to mapped views of the same shape and class', () => {
  const v = resolveViews(parsed.blocks, bundle);
  const ge = opened(v, parsed, 19);
  assert.deepEqual(ge.candidates, [
    { view: 'ge interface view', via: 'exact', realView: 'ge interface view' },
    { view: '100ge interface view', via: 'equivalent', realView: 'ge interface view' },
  ]);
  assert.deepEqual(ge.params, { 'interface-number': '0/2/1' });
  assert.equal(ge.interface.name, 'GigabitEthernet0/2/1');
  assert.equal(ge.resolved, true);
  assert.equal(ge.owner, ge.id);

  const sub = opened(v, parsed, 25);
  assert.deepEqual(sub.candidates, [
    { view: 'ge sub-interface view', via: 'exact', realView: 'ge sub-interface view' },
    { view: '100ge sub-interface view', via: 'equivalent', realView: 'ge sub-interface view' },
  ]);
  assert.deepEqual(sub.params, { 'interface-number': '0/2/1', 'sub-number': '111' });

  const lo = opened(v, parsed, 30);
  assert.deepEqual(lo.candidates.map(c => [c.view, c.via]), [['loopback interface view', 'exact']]);
  assert.deepEqual(lo.params, { 'loopback-number': '0' });
});

test('with equivalence off an interface keeps only its exact view', () => {
  const v = resolveViews(parsed.blocks, bundle, { equivalence: false });
  assert.deepEqual(opened(v, parsed, 19).candidates.map(c => c.view), ['ge interface view']);
});

test('other openers resolve by entry command or by a command that enters the view', () => {
  const v = resolveViews(parsed.blocks, bundle);
  const isis = opened(v, parsed, 15);
  assert.deepEqual(isis.candidates, [{ view: 'is-is view', via: 'exact', realView: 'is-is view' }]);
  assert.deepEqual(isis.params, { 'process-id': '207' });
  assert.equal(isis.interface, null);
  assert.deepEqual(opened(v, parsed, 6).params, { 'vpn-instance-name': 'L3VPN_A' });
  assert.deepEqual(opened(v, parsed, 7).candidates.map(c => c.view), ['vpn instance ipv4 address family view']);
  const aaa = opened(v, parsed, 12);
  assert.equal(aaa.resolved, false);
  assert.deepEqual(aaa.candidates, []);
  assert.equal(aaa.owner, aaa.id);
  assert.equal(opened(v, parsed, 4).resolved, false);  // sysname
});

test('an interface typed in another case and with a space still resolves', () => {
  const p = parseConfig('interface gigabitethernet 0/2/1\n ip address 1.1.1.1 24\n#\n');
  const v = resolveViews(p.blocks, bundle);
  assert.equal(v[0].candidates[0].view, 'ge interface view');
  assert.deepEqual(v[0].params, { 'interface-number': '0/2/1' });
});

test('unresolved nested blocks take their parent\'s owner; under an unresolved parent nothing resolves', () => {
  const p = parseConfig('ip vpn-instance B\n ipv6-family\n  foo 1\n#\nbgp 100\n ipv4-family unicast\n  peer 1.1.1.1 enable\n#\n');
  const v = resolveViews(p.blocks, bundle);
  assert.deepEqual(v.map(b => [b.resolved, b.owner]), [[true, 0], [false, 0], [false, 2], [false, 2]]);
});

test('a v1 bundle only knows the mapped interface views', () => {
  const f = JSON.parse(raw);
  delete f.viewIndex;
  f.formatVersion = 1;
  const p = parseConfig('interface GigabitEthernet0/2/1\n undo shutdown\n#\ninterface 100GE0/1/0\n undo shutdown\n#\n');
  const v = resolveViews(p.blocks, loadBundle(f));
  assert.equal(v[0].resolved, false);
  assert.deepEqual(v[1].candidates, [{ view: '100ge interface view', via: 'exact', realView: '100ge interface view' }]);
});

test('interfaceClass groups physical Ethernet types; every other type is its own class (I4)', () => {
  for (const t of ['GigabitEthernet', 'XGigabitEthernet', 'GE', '10GE', '100GE', 'ethernet', 'ge']) assert.equal(interfaceClass(t), 'ethernet', t);
  for (const t of ['Tunnel', 'LoopBack', 'Vlanif', 'NULL', 'Eth-Trunk']) {
    assert.notEqual(interfaceClass(t), 'ethernet', t);
    assert.equal(interfaceClass(t), interfaceClass(t.toUpperCase()), t);
  }
  assert.notEqual(interfaceClass('Tunnel'), interfaceClass('LoopBack'));
});

test('Tunnel and GE do not stand in for each other; GE and 100GE still do (I4)', () => {
  const f = JSON.parse(raw);
  f.viewIndex['tunnel interface view'] = { entryCommand: 'interface Tunnel <tunnel-number>', params: ['tunnel-number'], parentView: 'system view' };
  f.mappings.push({ ...f.mappings[0], id: 'm-tun', view: 'tunnel interface view' });
  const b = loadBundle(f);
  const p = parseConfig('interface GigabitEthernet0/2/1\n#\ninterface Tunnel1\n#\ninterface 100GE0/1/0\n#\n');
  const v = resolveViews(p.blocks, b);
  const views = i => v[i].candidates.map(c => [c.view, c.via]);
  assert.deepEqual(views(0), [['ge interface view', 'exact'], ['100ge interface view', 'equivalent']]);
  assert.deepEqual(views(1), [['tunnel interface view', 'exact']]);
  assert.deepEqual(views(2), [['100ge interface view', 'exact'], ['ge interface view', 'equivalent']]);
});
