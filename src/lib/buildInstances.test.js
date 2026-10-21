import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { parseConfig } from './parseConfig.js';
import { resolveViews } from './resolveViews.js';
import { matchLines } from './matchLines.js';
import { buildInstances, titleTokens } from './buildInstances.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const parsed = parseConfig(excerpt);
const build = (bundle = loadBundle(raw)) => {
  const views = resolveViews(parsed.blocks, bundle);
  return buildInstances(matchLines(parsed, views, bundle), parsed, views, bundle);
};
const find = (list, opener, entity) => list.find(i => i.opener === opener && i.dte.entity === entity);

test('titleTokens keeps distinctive words of a command title', () => {
  assert.deepEqual(titleTokens('isis enable'), ['isis']);
  assert.deepEqual(titleTokens('ip binding vpn-instance'), ['binding', 'vpn']);
  assert.deepEqual(titleTokens('vlan-type dot1q'), ['vlan', 'dot']);
  assert.deepEqual(titleTokens(null), []);
});

test('one instance per block and DTE entity, named by key, key field, interface or opener', () => {
  assert.deepEqual(build().map(i => [i.opener, i.dte.entity, i.name]), [
    [6, 'VRF', 'L3VPN_A'],
    [15, 'IGP', '207'],
    [19, 'FixedNetworkLTP', 'GigabitEthernet0/2/1'],
    [19, 'LTP', 'GigabitEthernet0/2/1'],
    [19, 'VRF', 'L3VPN_A'],
    [25, 'FixedNetworkLTP', 'GigabitEthernet0/2/1.111'],
    [25, 'LTP', 'GigabitEthernet0/2/1.111'],
    [25, 'PW', 'GigabitEthernet0/2/1.111'],
    [30, 'FixedNetworkLTP', 'LoopBack0'],
    [30, 'LTP', 'LoopBack0'],
  ]);
});

test('fields collect deduplicated values from every line of the instance', () => {
  const list = build();
  const vrf = find(list, 6, 'VRF');
  assert.equal(vrf.id, 'Twin_VRF@L6');
  assert.deepEqual(vrf.dte.fields, { vrfName: ['L3VPN_A'], rd: ['100:1'], rt: ['100:1'] });
  assert.deepEqual(vrf.lines, [6, 8, 9, 10]);
  assert.deepEqual([vrf.view, vrf.via], ['vpn instance view', 'exact']);
  assert.deepEqual(find(list, 15, 'IGP').dte.fields, { igpId: ['207'], networkEntityId: ['49.0001.0010.0100.1207.00'] });
  assert.deepEqual(find(list, 25, 'PW').dte.fields, { pwId: ['7'] });
  assert.deepEqual(find(list, 19, 'FixedNetworkLTP').matches, [
    { n: 22, mappingId: 'm-ip', field: 'IP__addrv4', value: '10.0.0.1', via: 'exact' },
    { n: 23, mappingId: 'm-isisen', field: null, value: null, via: 'equivalent' },
  ]);
});

test('topology candidates narrow by command keywords and by sibling entities\' schemas', () => {
  const list = build();
  const all = ['ethernetport', 'vlaninterface', 'ipv4interface', 'isisinterface', 'vpwssap', 'l3vpnsap'];
  const ge = find(list, 19, 'FixedNetworkLTP');
  assert.deepEqual(ge.topology, ['isisinterface', 'l3vpnsap']);
  assert.deepEqual(ge.topologyCandidates, all);
  assert.deepEqual(find(list, 25, 'FixedNetworkLTP').topology, ['vlaninterface', 'vpwssap']);
  assert.deepEqual(find(list, 30, 'FixedNetworkLTP').topology, all);
  assert.deepEqual(find(list, 19, 'LTP').topology, ['ethernetport']);
});

test('a keyless group in a nested block joins the enclosing instance of the same entity', () => {
  const f = JSON.parse(raw);
  const fam = 'vpn instance ipv4 address family view';
  for (const fid of ['f-rd', 'f-rt']) f.commands[fid].parentViews = [fam];
  for (const m of f.mappings) if (m.id === 'm-rd' || m.id === 'm-rt') m.view = fam;
  const list = build(loadBundle(f));
  assert.equal(list.some(i => i.opener === 7), false);
  const vrf = find(list, 6, 'VRF');
  assert.deepEqual(vrf.dte.fields, { vrfName: ['L3VPN_A'], rd: ['100:1'], rt: ['100:1'] });
  assert.deepEqual(vrf.matches.map(m => [m.n, m.via]), [[6, 'exact'], [8, 'exact'], [9, 'exact'], [10, 'exact']]);
});
