import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annotate } from '../annotate.js';
import { toInstancesJson } from './json.js';
import { toAnnotatedText, matchNote } from './text.js';
import { toHtmlReport, escapeHtml } from './html.js';

const raw = readFileSync(new URL('../../../test/fixtures/bundle-v2.json', import.meta.url), 'utf8');
const excerpt = readFileSync(new URL('../../../test/fixtures/device-excerpt.txt', import.meta.url), 'utf8');
const result = annotate(excerpt, raw);

test('JSON instances carry the device, bundle, coverage and every instance', () => {
  const j = toInstancesJson(result, { dumpFile: 'device_207.txt' });
  assert.equal(j.format, 'cli-annotator.instances');
  assert.equal(j.version, 1);
  assert.equal(j.dumpFile, 'device_207.txt');
  assert.deepEqual(j.device, result.device);
  assert.deepEqual(j.coverage, { mappings: result.coverage.mappings, lines: result.coverage.lines });
  assert.equal(j.instances.length, result.instances.length);
  const vrf = j.instances.find(i => i.id === 'Twin_VRF@L6');
  assert.deepEqual(Object.keys(vrf), ['id', 'block', 'opener', 'view', 'via', 'name', 'dte', 'topology', 'topologyCandidates', 'lines']);
  assert.equal(JSON.stringify(j).includes('FAKESECRET'), false);
});

test('match notes name the entity, field, value, topology and the stood-in view', () => {
  const byId = new Map(result.instances.map(i => [i.id, i]));
  const note = n => result.lines[n - 1].matches.map(m => matchNote(m, byId));
  assert.deepEqual(note(22), ['DTE FixedNetworkLTP.IP__addrv4=10.0.0.1 | topo isisinterface, l3vpnsap']);
  assert.deepEqual(note(23), ['DTE FixedNetworkLTP | topo isisinterface, l3vpnsap ≈ 100ge interface view']);
  assert.match(note(8)[0], /^DTE VRF\.rd=100:1( \| topo .+)?$/);
});

test('annotated text is the dump plus comment lines', () => {
  const text = toAnnotatedText(result);
  assert.ok(text.endsWith('\n'));
  const notes = text.split('\n').filter(l => /^\s*! @ /.test(l));
  assert.ok(notes.length > 15);
  const stripped = text.split('\n').filter(l => !/^\s*! @ /.test(l)).join('\n');
  assert.equal(stripped, result.lines.map(l => l.text).join('\n') + '\n');
  assert.ok(text.includes([
    'interface GigabitEthernet0/2/1',
    '! @ FixedNetworkLTP GigabitEthernet0/2/1',
    '! @ LTP GigabitEthernet0/2/1',
    '! @ VRF L3VPN_A',
  ].join('\n')));
  assert.match(text, /^! @ DTE LTP(\.\w+)?=GigabitEthernet0\/2\/1 \| topo ethernetport ≈ 100ge interface view$/m);
  assert.ok(text.includes(' ip address 10.0.0.1 255.255.255.0\n ! @ DTE FixedNetworkLTP.IP__addrv4=10.0.0.1 | topo isisinterface, l3vpnsap\n'));
});

test('the HTML report is self-contained and escapes dump text', () => {
  const html = toHtmlReport(annotate(excerpt.replace(' undo shutdown', ' description <b>core</b> & "x"'), raw), { dumpFile: 'device_207.txt' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('description &lt;b&gt;core&lt;/b&gt; &amp; &quot;x&quot;'));
  assert.equal(html.includes('<b>core</b>'), false);
  assert.equal(/<script/i.test(html), false);
  assert.equal(/\b(src|href)="(https?:)?\/\//i.test(html), false);
  assert.ok(html.includes('id="L22"'));
  assert.ok(html.includes('href="#L19"'));
  assert.match(html, /class="ln via-equivalent" id="L23"/);
  assert.ok(html.includes('device_207.txt'));
  assert.equal(escapeHtml(`<a href='x'>&</a>`), '&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
});

test('the HTML report escapes script payloads in line text and values', () => {
  const evil = '<script>alert("x")</script>';
  const r = annotate(excerpt.replace(' undo shutdown', ` description ${evil}`).replace('ip address 10.0.0.1', `ip address "${evil}"`), raw);
  const html = toHtmlReport(r);
  assert.equal(/<script/i.test(html), false);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
});

test('the HTML report escapes payloads in sysname, instance names, warnings, gaps and via (M4)', () => {
  const evil = `<script>alert('x')</script>"`;
  const r = structuredClone(result);
  r.device.sysname = evil;
  r.instances[0].name = evil;
  r.warnings = [evil];
  r.gaps = {
    dteWithoutCli: [{ logicalName: evil, topology: [evil] }],
    topologyWithoutDte: [{ entity: evil, schema: evil }],
    dteNotFound: [{ topologyEntity: evil, dteEntity: evil }],
  };
  const line = r.lines.find(l => l.matches.length);
  line.matches[0].via = `x" onmouseover="alert(1)`;
  const html = toHtmlReport(r);
  assert.equal(/<script/i.test(html), false);
  assert.equal(html.includes('onmouseover="'), false);
  assert.ok(html.includes('via-x&quot; onmouseover=&quot;alert(1)'));
  assert.ok(html.split('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&quot;').length - 1 >= 7);
});

test('annotated text pads notes with the line\'s own indent, tabs included (M5)', () => {
  const r = structuredClone(result);
  const line = r.lines.find(l => l.matches.length && l.indent > 0);
  line.text = '\t' + line.text.trimStart();
  line.indent = 1;
  const text = toAnnotatedText(r);
  assert.ok(text.includes(`${line.text}\n\t! @ `), 'note is tab-indented');
});
