import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseName, readFiles } from './files.js';
import { lastBundle, rememberBundle } from './lastBundle.js';

test('baseName drops the last extension only', () => {
  assert.equal(baseName('device_207.txt'), 'device_207');
  assert.equal(baseName('topo-cli-bundle-NE8000.v2.json'), 'topo-cli-bundle-NE8000.v2');
  assert.equal(baseName('noext'), 'noext');
});

test('readFiles reads every file as text', async () => {
  const files = [new File(['a\n'], 'one.txt'), new File(['b'], 'two.txt')];
  assert.deepEqual(await readFiles(files), [{ name: 'one.txt', text: 'a\n' }, { name: 'two.txt', text: 'b' }]);
});

test('the last bundle is remembered by name and time only, and storage failures are ignored', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(lastBundle(), null);
  rememberBundle('b.json', '2026-10-21T09:00:00.000Z');
  assert.deepEqual(JSON.parse(store.get('cli-annotator.lastBundle')), { name: 'b.json', generatedAt: '2026-10-21T09:00:00.000Z' });
  assert.deepEqual(lastBundle(), { name: 'b.json', generatedAt: '2026-10-21T09:00:00.000Z' });
  store.set('cli-annotator.lastBundle', 'not json');
  assert.equal(lastBundle(), null);
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => rememberBundle('b.json', null));
  assert.equal(lastBundle(), null);
  delete globalThis.localStorage;
});
