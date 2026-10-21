import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { parseConfig } from './parseConfig.js';
import { resolveViews } from './resolveViews.js';
import { matchLines, ALL_VIEWS } from './matchLines.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const parsed = parseConfig(excerpt);
const run = (bundle = loadBundle(raw), opts, p = parsed) => matchLines(p, resolveViews(p.blocks, bundle, opts), bundle);
const summary = ms => ms.map(m => [m.n, m.mapping.id, m.via, m.value]);

test('every mapped line of the excerpt matches, with its view relation and value', () => {
  assert.deepEqual(summary(run()), [
    [6, 'm-vrf', 'exact', 'L3VPN_A'],
    [8, 'm-rd', 'enclosing', '100:1'],
    [9, 'm-rt', 'enclosing', '100:1'],
    [10, 'm-rt', 'enclosing', '100:1'],
    [15, 'm-isis', 'exact', '207'],
    [17, 'm-net', 'exact', '49.0001.0010.0100.1207.00'],
    [19, 'm-ltp', 'equivalent', 'GigabitEthernet0/2/1'],
    [21, 'm-bind', 'exact', 'L3VPN_A'],
    [22, 'm-ip', 'exact', '10.0.0.1'],
    [23, 'm-isisen', 'equivalent', null],
    [25, 'm-ltp-sub', 'equivalent', 'GigabitEthernet0/2/1.111'],
    [26, 'm-vlan', 'equivalent', '111'],
    [28, 'm-l2vc', 'exact', '7'],
    [30, 'm-ltp', 'equivalent', 'LoopBack0'],
    [31, 'm-ip', 'exact', '1.1.1.207'],
  ]);
});

test('matches carry their view, the real view and the block they belong to', () => {
  const ms = run();
  const at = n => ms.find(m => m.n === n);
  const vpnBlock = parsed.lines[5].opens;
  assert.deepEqual([at(8).view, at(8).block, at(8).kind], ['vpn instance view', vpnBlock, 'command']);
  assert.equal(at(6).kind, 'view');
  assert.equal(at(6).block, vpnBlock);
  assert.equal(at(15).block, parsed.lines[14].opens);
  assert.deepEqual([at(23).view, at(23).realView], ['100ge interface view', 'ge interface view']);
  assert.deepEqual(at(28).params, { 'instance-name': 'GigabitEthernet0/2/1.111', 'ip-address': '192.0.2.9', 'vc-id': '7' });
  assert.equal(at(22).prefixOnly, false);
});

test('with equivalence off only exact views and the enclosing fallback match', () => {
  const ms = run(undefined, { equivalence: false });
  assert.deepEqual([...new Set(ms.map(m => m.n))], [6, 8, 9, 10, 15, 17, 21, 22, 28, 31]);
});

test('all-views mappings match on every line, also inside unresolved blocks', () => {
  const f = JSON.parse(raw);
  f.commands['f-host'] = { title: 'sysname', syntax: ['sysname <host-name>'], parentViews: [ALL_VIEWS], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-host', sourceType: 'command', featureId: 'f-host', title: 'sysname', view: ALL_VIEWS, viewFamily: null,
    cliParameter: 'host-name', isKey: false, keyHint: null, dte: { id: 'Twin_NE', entity: 'NE', field: 'name' }, relation: 'configures', topology: [] });
  const ms = run(loadBundle(f));
  assert.deepEqual(summary(ms.filter(m => m.mapping.id === 'm-host')), [[4, 'm-host', 'all', 'PE207']]);
  const p = parseConfig('aaa\n sysname X\n#\n');
  const inAaa = run(loadBundle(f), undefined, p);
  assert.deepEqual(summary(inAaa), [[2, 'm-host', 'all', 'X']]);
  assert.equal(inAaa[0].view, ALL_VIEWS);
});

test('a command whose syntax is not understood matches by its leading keywords, flagged prefixOnly', () => {
  const f = JSON.parse(raw);
  f.commands['f-mtu'] = { title: 'mtu', syntax: ['mtu <mtu> [ spread'], parentViews: ['ge sub-interface view'], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-mtu', sourceType: 'command', featureId: 'f-mtu', title: 'mtu', view: 'ge sub-interface view', viewFamily: null,
    cliParameter: 'mtu', isKey: false, keyHint: null, dte: { id: 'Twin_FixedNetworkLTP', entity: 'FixedNetworkLTP', field: 'mtu' }, relation: 'configures', topology: [] });
  const m = run(loadBundle(f)).find(x => x.mapping.id === 'm-mtu');
  assert.deepEqual([m.n, m.prefixOnly, m.value], [27, true, null]);
});
