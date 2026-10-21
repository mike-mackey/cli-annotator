import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(raw);

test('loads a v2 bundle and splits command and view mappings', () => {
  const b = loadBundle(raw);
  assert.equal(b.formatVersion, 2);
  assert.deepEqual(b.device, { name: 'NE8000', softwareVersion: 'V800R022C00SPC600' });
  assert.equal(b.commandMappings.length, 9);
  assert.deepEqual(b.viewMappings['100ge interface view'].map(m => m.id), ['m-ltp']);
  assert.deepEqual(b.viewIndex['is-is view'].enteredBy, ['f-isis']);
  assert.deepEqual(b.warnings, []);
});

test('accepts an object and does not mutate its viewIndex', () => {
  const f = fixture();
  const b = loadBundle(f);
  b.viewIndex['is-is view'].enteredBy.push('x');
  assert.deepEqual(f.viewIndex['is-is view'].enteredBy, ['f-isis']);
});

test('rejects invalid JSON, a wrong format and an unknown version with a readable message', () => {
  assert.throws(() => loadBundle('{nope'), /Bundle is not valid JSON/);
  assert.throws(() => loadBundle({ format: 'x' }), /Not an annotation bundle: expected format "ontology-ui.topo-cli-annotation-bundle", got "x"/);
  assert.throws(() => loadBundle({ ...fixture(), formatVersion: 3 }), /Unsupported bundle formatVersion 3/);
});

test('a v1 bundle gets a view index from its view paths and the commands that enter views', () => {
  const f = fixture();
  delete f.viewIndex;
  f.formatVersion = 1;
  const b = loadBundle(f);
  assert.deepEqual(b.viewIndex['100ge interface view'],
    { entryCommand: 'interface 100GE <interface-number>', params: ['interface-number'], parentView: 'system view' });
  assert.equal(b.viewIndex['system view'].parentView, null);
  assert.deepEqual(b.viewIndex['is-is view'].enteredBy, ['f-isis']);
  assert.equal(b.viewIndex['ge interface view'], undefined);
  assert.match(b.warnings[0], /Bundle format v1 has no view index/);
});

test('a command mapping without catalogue syntax is left out and named in a warning', () => {
  const f = fixture();
  delete f.commands['f-net'];
  const b = loadBundle(f);
  assert.equal(b.commandMappings.some(m => m.id === 'm-net'), false);
  assert.match(b.warnings[0], /No catalogue syntax for 1 mapped command\(s\), so they are never matched: network-entity/);
});

test('view-family mappings are dropped with a warning (no member list in the bundle)', () => {
  const f = fixture();
  f.mappings.push({ ...f.mappings[0], id: 'm-fam', sourceType: 'view-family', featureId: null, title: 'FAKE family view', view: 'ge interface view', viewFamily: 'FAKE family view' });
  const b = loadBundle(f);
  assert.equal(Object.values(b.viewMappings).flat().some(m => m.id === 'm-fam'), false);
  assert.equal(b.commandMappings.some(m => m.id === 'm-fam'), false);
  assert.match(b.warnings.join('\n'), /1 view-family mapping\(s\) are not applied, since the bundle does not list the family's views: FAKE family view/);
});
