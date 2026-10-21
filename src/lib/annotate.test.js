import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle } from './bundle.js';
import { annotate } from './annotate.js';

const raw = readFileSync(new URL('../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const lineAt = (r, n) => r.lines[n - 1];
const pairs = (r, n) => lineAt(r, n).matches.map(m => [m.mappingId, m.via]);

test('annotates the excerpt end to end', () => {
  const r = annotate(excerpt, raw);
  assert.deepEqual(r.options, { equivalence: true, redact: true });
  assert.deepEqual(r.device, { softwareVersion: 'V800R025C10SPC500', sysname: 'PE207' });
  assert.deepEqual(r.coverage.mappings, { total: 12, found: 12 });
  assert.deepEqual(r.coverage.lines, { config: 22, matched: 15 });
  assert.equal(r.coverage.byMapping['m-rt'], 2);
  assert.deepEqual(r.unmatched, [4, 7, 12, 13, 16, 20, 27]);
  assert.equal(r.coverage.blocks.total, 7);
  assert.deepEqual(r.coverage.blocks.unresolved.map(b => [b.opener, b.text]), [[12, 'aaa']]);
  assert.deepEqual(pairs(r, 22), [['m-ip', 'exact']]);
  assert.deepEqual(pairs(r, 23), [['m-isisen', 'equivalent']]);
  assert.deepEqual(pairs(r, 30), [['m-ltp', 'equivalent']]);
  assert.deepEqual(lineAt(r, 19).views.map(v => [v.view, v.via]).slice(0, 2),
    [['ge interface view', 'exact'], ['100ge interface view', 'equivalent']]);
  assert.equal(lineAt(r, 22).matches[0].instance, 'Twin_FixedNetworkLTP@L19');
  assert.equal(lineAt(r, 22).matches[0].value, '10.0.0.1');
  assert.deepEqual(lineAt(r, 22).matches[0].dte, { id: 'Twin_FixedNetworkLTP', entity: 'FixedNetworkLTP', field: 'IP__addrv4' });
  const loop = r.instances.filter(i => i.opener === 30).map(i => [i.dte.entity, i.via]);
  assert.deepEqual(loop, [['FixedNetworkLTP', 'exact'], ['LTP', 'equivalent']]);
  assert.deepEqual(r.instances.find(i => i.opener === 19 && i.dte.entity === 'FixedNetworkLTP').topology, ['isisinterface', 'l3vpnsap']);
  assert.deepEqual(r.gaps, JSON.parse(raw).gaps);
});

test('switching equivalence off keeps only exact and enclosing matches', () => {
  const r = annotate(excerpt, raw, { equivalence: false });
  assert.deepEqual(r.lines.filter(l => l.matches.length).map(l => l.n), [6, 8, 9, 10, 15, 17, 21, 22, 28, 31]);
  assert.deepEqual(r.coverage.lines, { config: 22, matched: 10 });
});

test('accepts a loaded bundle, a parsed object or JSON text alike', () => {
  const a = annotate(excerpt, raw);
  assert.deepEqual(annotate(excerpt, loadBundle(raw)), a);
  assert.deepEqual(annotate(excerpt, JSON.parse(raw)), a);
  assert.throws(() => annotate(excerpt, '{"format":"other"}'), /Not an annotation bundle/);
});

test('warns about a missing header, a version mismatch and prefix-only matches', () => {
  const f = JSON.parse(raw);
  f.device.softwareVersion = 'V800R025C10SPC500';
  assert.deepEqual(annotate(excerpt, f).warnings, []);
  f.device.softwareVersion = 'X1';
  assert.ok(annotate(excerpt, f).warnings.some(w => /software version V800R025C10SPC500 differs from the bundle's X1/.test(w)));
  const noHeader = excerpt.split('\n').slice(1).join('\n');
  assert.ok(annotate(noHeader, f).warnings.some(w => /no "!Software Version" header/.test(w)));
  f.commands['f-mtu'] = { title: 'mtu', syntax: ['mtu <mtu> [ spread'], parentViews: ['ge sub-interface view'], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-mtu', sourceType: 'command', featureId: 'f-mtu', title: 'mtu', view: 'ge sub-interface view', viewFamily: null,
    cliParameter: 'mtu', isKey: false, keyHint: null, dte: { id: 'Twin_FixedNetworkLTP', entity: 'FixedNetworkLTP', field: 'mtu' },
    relation: 'configures', relationType: '1:1', topology: [] });
  assert.ok(annotate(excerpt, f).warnings.includes('Matched by leading keywords only (syntax not understood): mtu.'));
});

test('a secret captured as a mapped value is masked everywhere when redaction is on', () => {
  const f = JSON.parse(raw);
  f.viewIndex['aaa view'] = { entryCommand: 'aaa', params: [], parentView: 'system view' };
  f.commands['f-user'] = { title: 'local-user password', syntax: ['local-user <user-name> password irreversible-cipher <password>'],
    parentViews: ['aaa view'], enableViews: [], parameters: [], examples: [] };
  f.mappings.push({ id: 'm-user', sourceType: 'command', featureId: 'f-user', title: 'local-user password', view: 'aaa view', viewFamily: null,
    cliParameter: 'password', isKey: false, keyHint: null, dte: { id: 'Twin_User', entity: 'User', field: 'password' },
    relation: 'configures', relationType: '1:1', topology: [] });

  const r = annotate(excerpt, f);
  const m = lineAt(r, 13).matches[0];
  assert.equal(m.mappingId, 'm-user');
  assert.equal(m.value, '****');
  assert.equal(m.params.password, '****');
  assert.equal(lineAt(r, 13).redacted, true);
  assert.deepEqual(r.instances.find(i => i.dte.id === 'Twin_User').dte.fields, { password: ['****'] });
  assert.equal(JSON.stringify(r).includes('FAKESECRET'), false);

  const open = annotate(excerpt, f, { redact: false });
  assert.equal(lineAt(open, 13).matches[0].value, '$1c$FAKESECRETFAKE$');
  assert.equal(lineAt(open, 13).redacted, false);
});
