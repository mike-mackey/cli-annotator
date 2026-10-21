import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, buildInterfaceIndex, parseInterfaceOpener } from './interfaces.js';

test('shapeOf reads the type keyword and the shape of an interface entry command', () => {
  assert.deepEqual(shapeOf('interface GigabitEthernet <interface-number>'), { type: 'GigabitEthernet', shape: 'main' });
  assert.deepEqual(shapeOf('interface 100GE <interface-number>.<sub-number>'), { type: '100GE', shape: 'sub' });
  assert.deepEqual(shapeOf('interface 25GE <interface-number>.<sub-number> mode l2'), { type: '25GE', shape: 'l2sub' });
  assert.deepEqual(shapeOf('interface LoopBack <loopback-number>'), { type: 'LoopBack', shape: 'main' });
  assert.deepEqual(shapeOf('interface Eth-Trunk <trunk-id>'), { type: 'Eth-Trunk', shape: 'main' });
  assert.equal(shapeOf('interface <interface-type> <interface-number>'), null);
  assert.equal(shapeOf('isis <process-id>'), null);
  assert.equal(shapeOf(null), null);
});

const viewIndex = {
  'system view': { entryCommand: 'system-view', params: [], parentView: 'user view' },
  'ge interface view': { entryCommand: 'interface GigabitEthernet <interface-number>', params: ['interface-number'], parentView: 'system view' },
  'ge sub-interface view': { entryCommand: 'interface GigabitEthernet <interface-number>.<sub-number>', params: ['interface-number', 'sub-number'], parentView: 'system view' },
  '100ge interface view': { entryCommand: 'interface 100GE <interface-number>', params: ['interface-number'], parentView: 'system view' },
  'ge-alias view': { entryCommand: 'interface gigabitethernet <interface-number>', params: ['interface-number'], parentView: 'system view' },
  'loopback interface view': { entryCommand: 'interface LoopBack <loopback-number>', params: ['loopback-number'], parentView: 'system view' },
  'is-is view': { entryCommand: null, params: [], parentView: 'system view', enteredBy: ['f-isis'] },
};

test('buildInterfaceIndex lists interface views and their types, longest type first', () => {
  const idx = buildInterfaceIndex(viewIndex);
  assert.deepEqual(idx.types, ['GigabitEthernet', 'LoopBack', '100GE']);
  assert.deepEqual(idx.views.find(v => v.view === 'ge sub-interface view'), { view: 'ge sub-interface view', type: 'GigabitEthernet', shape: 'sub' });
  assert.equal(idx.views.some(v => v.view === 'is-is view'), false);
  assert.equal(idx.views.length, 5);
});

test('parseInterfaceOpener splits joined names and keeps the dump spelling in name', () => {
  const { types } = buildInterfaceIndex(viewIndex);
  assert.deepEqual(parseInterfaceOpener('interface GigabitEthernet0/2/1', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: null, name: 'GigabitEthernet0/2/1', shape: 'main' });
  assert.deepEqual(parseInterfaceOpener('interface GigabitEthernet0/2/1.111', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: '111', name: 'GigabitEthernet0/2/1.111', shape: 'sub' });
  assert.deepEqual(parseInterfaceOpener('interface GigabitEthernet0/2/1.77 mode l2', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: '77', name: 'GigabitEthernet0/2/1.77', shape: 'l2sub' });
  assert.deepEqual(parseInterfaceOpener('interface LoopBack0', types),
    { type: 'LoopBack', number: '0', sub: null, name: 'LoopBack0', shape: 'main' });
});

test('parseInterfaceOpener accepts another case and a space before the number', () => {
  const { types } = buildInterfaceIndex(viewIndex);
  assert.deepEqual(parseInterfaceOpener('interface gigabitethernet 0/2/1', types),
    { type: 'GigabitEthernet', number: '0/2/1', sub: null, name: 'gigabitethernet0/2/1', shape: 'main' });
  assert.deepEqual(parseInterfaceOpener('interface 100GE0/1/0', types),
    { type: '100GE', number: '0/1/0', sub: null, name: '100GE0/1/0', shape: 'main' });
});

test('parseInterfaceOpener returns null for unknown types, non-digit ids, other lines and unknown suffixes', () => {
  const { types } = buildInterfaceIndex(viewIndex);
  assert.equal(parseInterfaceOpener('interface Vlanif10', types), null);
  assert.equal(parseInterfaceOpener('interface GigabitEthernetX', types), null);
  assert.equal(parseInterfaceOpener('isis 207', types), null);
  assert.equal(parseInterfaceOpener('interface GigabitEthernet0/2/1 mode l3', types), null);
});

test('parseInterfaceOpener handles case and spacing variants', () => {
  const { types } = buildInterfaceIndex(viewIndex);
  const p = t => parseInterfaceOpener(t, types);
  assert.deepEqual(p('INTERFACE GIGABITETHERNET0/2/1.5 MODE L2'),
    { type: 'GigabitEthernet', number: '0/2/1', sub: '5', name: 'GIGABITETHERNET0/2/1.5', shape: 'l2sub' });
  assert.equal(p('interface loopback 0').name, 'loopback0');
  assert.equal(p('interface 100ge0/1/0').type, '100GE');
  assert.equal(p('  interface GigabitEthernet0/2/1  ').name, 'GigabitEthernet0/2/1');
  assert.equal(p('interface   GigabitEthernet0/2/1').name, 'GigabitEthernet0/2/1');
  assert.equal(p('interface GigabitEthernet  0/2/1'), null);
  assert.equal(p('interface GigabitEthernet0/2/1.5   mode   l2').shape, 'l2sub');
  assert.equal(p('interface GigabitEthernet0/2/1 mode  l2'), null);
  assert.equal(p('interface GigabitEthernet0/2/1 mode l2'), null);
  assert.equal(p('interfaceGigabitEthernet0/2/1'), null);
});
