import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-dumps.mjs', import.meta.url));
const fx = name => fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('prints coverage, keywords and instance names for each dump', () => {
  const r = run(fx('bundle-v2.json'), fx('device-excerpt.txt'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^device-excerpt\.txt$/m);
  assert.match(r.stdout, /mappings found 12\/12; config lines matched 14\/22; blocks unresolved 1\/7/);
  assert.match(r.stdout, /unresolved blocks by keyword: aaa ×1/);
  assert.match(r.stdout, /unmatched lines by keyword: .*local-user ×1/);
  assert.match(r.stdout, /GigabitEthernet0\/2\/1\.111/);
});

test('never prints a line of the dump', () => {
  const { stdout } = run(fx('bundle-v2.json'), fx('device-excerpt.txt'));
  for (const s of ['FAKESECRET', 'irreversible-cipher', '10.0.0.1', '255.255.255.0', '1.1.1.207', 'vpn-target']) {
    assert.ok(!stdout.includes(s), `output contains ${s}`);
  }
});

test('--no-equivalence matches only the exact views', () => {
  const r = run('--no-equivalence', fx('bundle-v2.json'), fx('device-excerpt.txt'));
  assert.match(r.stdout, /config lines matched 10\/22/);
});

test('a missing argument is a usage error', () => {
  const r = run(fx('bundle-v2.json'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/check-dumps\.mjs/);
});

test('an unknown --flag is a usage error and nothing is checked (M6)', () => {
  const r = run('--no-equivalnce', fx('bundle-v2.json'), fx('device-excerpt.txt'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option: --no-equivalnce/);
  assert.match(r.stderr, /usage: node scripts\/check-dumps\.mjs/);
  assert.equal(r.stdout, '');
});
