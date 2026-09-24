import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MESSAGES, normalizeLanguage, translate } from '../src/i18n.js';
import { readDshLanguage, observeDshLanguage } from '../src/adapter.js';

for (const [input, expected] of [['zh','zh'], ['zh-CN','zh'], ['ZH_hans','zh'], ['zh-TW','zh'], ['en-US','en'], ['ja','en'], ['fr','en'], [undefined,'en'], [null,'en'], ['', 'en']]) {
  test(`language ${String(input)} resolves to ${expected}`, () => assert.equal(normalizeLanguage(input), expected));
}
test('both dictionaries have complete matching nonempty keys', () => {
  assert.deepEqual(Object.keys(MESSAGES.zh).sort(), Object.keys(MESSAGES.en).sort());
  for (const language of ['en','zh']) for (const [key, value] of Object.entries(MESSAGES[language])) {
    assert.equal(typeof value, 'string'); assert.ok(value.trim()); assert.equal(translate(language,key), value);
  }
});
test('translation interpolation and fallback are literal text, not HTML', () => {
  assert.match(translate('en','pet.aria',{ status:'Working on it…' }), /^Working on it… Click/);
  assert.equal(translate('de','state.waiting'), 'A little help?');
  assert.equal(translate('en','missing.key'), 'missing.key');
});
test('DSH resolved active is read, never the preference or browser fallback', () => {
  assert.equal(readDshLanguage({ getSnapshot: () => ({ active:'zh', preference:'en', locales:[], revision:0 }) }), 'zh');
  assert.equal(readDshLanguage({ getSnapshot: () => ({ active:'en', preference:'zh' }) }), 'en');
  assert.equal(readDshLanguage({ getSnapshot() { throw Error('missing service'); } }), 'en');
  assert.equal(readDshLanguage(undefined), 'en');
});
test('subscribe applies initial DSH language, changes live and releases exactly once', () => {
  let active = 'zh', revision = 0, unsubscriptions = 0;
  const listeners = new Set(), seen = [];
  const locale = { getSnapshot: () => ({ active, revision }), subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); unsubscriptions++; }; } };
  const stop = observeDshLanguage(locale, value => seen.push(value));
  const notify = value => { active=value;revision++;for(const listener of listeners)listener(); };
  assert.deepEqual(seen,['zh']); notify('en');notify('en');notify('ja');notify('zh-CN');
  assert.deepEqual(seen,['zh','en','zh']);
  stop();stop();notify('en');assert.equal(unsubscriptions,1);assert.equal(listeners.size,0);assert.deepEqual(seen,['zh','en','zh']);
});
test('absent locale service has a safe English initial fallback', () => {
  const seen=[];const stop=observeDshLanguage(undefined,value=>seen.push(value));assert.deepEqual(seen,['en']);stop();stop();
});
test('localized package metadata exports resolve and preserve chosen npm description', () => {
  const require = createRequire(new URL('../package.json',import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const english = JSON.parse(fs.readFileSync(require.resolve('dsh-plugin-whale-pet/locale/en.json'),'utf8'));
  const chinese = JSON.parse(fs.readFileSync(require.resolve('dsh-plugin-whale-pet/locale/zh.json'),'utf8'));
  assert.equal(manifest.description,'Your little whale buddy for work, wins, and well-earned naps.');
  assert.equal(english.meta.description,manifest.description);assert.equal(chinese.meta.title,'小鲸鱼');
  assert.ok(chinese.meta.description);assert.ok(manifest.files.includes('locale'));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
});
