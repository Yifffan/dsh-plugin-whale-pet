import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('package.json'));
test('package is a self-contained DSH bundle with only its own inserted row', () => {
  assert.equal(manifest.name, 'dsh-plugin-whale-pet');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  for (const target of Object.values(manifest.exports)) assert.equal(fs.existsSync(path.join(root, target)), true);
  assert.equal((read('cordis.patch.yml').match(/- id:/g) || []).length, 1);
  assert.match(read('cordis.patch.yml'), /id: whale-pet\s*\n\s*name: dsh-plugin-whale-pet/);
  assert.equal(manifest.dependencies, undefined);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
    assert.equal(manifest.scripts[hook], undefined);
  }
  assert.equal(manifest.version, '0.2.8');
  assert.equal(fs.existsSync(path.join(root, 'lib/version.js')), false);
  assert.equal(manifest.files.includes('DIAGNOSTICS.md'), false);
  assert.deepEqual(manifest.repository, { type: 'git', url: 'git+https://github.com/Yifffan/dsh-plugin-whale-pet.git' });
  assert.equal(manifest.homepage, 'https://github.com/Yifffan/dsh-plugin-whale-pet');
  assert.equal(manifest.bugs.url, `${manifest.homepage}/issues`);
  assert.equal(manifest.packageManager, 'pnpm@11.7.0');
  assert.equal(manifest.engines.node, '>=22');
  assert.equal(manifest.scripts.build, 'node tools/bridge-build.mjs && node tools/build.mjs');
  assert.equal(manifest.scripts.test, 'node --test tests/*.test.mjs');
  assert.equal(manifest.scripts['test:browser'], undefined);
  assert.ok(manifest.files.includes('UPGRADE.md'));
  assert.doesNotMatch(read('tools/bridge-build.mjs'), /WHALE_BRIDGE_DEPS|\/Users\/|dsh-pet-research/);
});
test('formal runtime has no diagnostic feature or prerelease helper', () => {
  for (const file of ['src/widget.js', 'src/adapter.js', 'src/bridge-client.js', 'src/host-bridge.js', 'src/global-state.js', 'lib/client.js', 'lib/index.js', 'lib/remote.js', 'lib/typert.host.js']) {
    assert.doesNotMatch(read(file), /WhaleDiagnostics|refreshHostDiagnostics|WHALE_DIAGNOSTICS|onDiagnosticsRefresh|diagnostics-toggle|namespaceFailures/);
  }
  assert.equal(fs.existsSync(path.join(root, 'src/diagnostics.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'DIAGNOSTICS.md')), false);
  assert.ok(manifest.files.includes('CHANGELOG.md'));
  assert.doesNotMatch(read('README.md'), /Local test build|Local diagnostic build|Install the beta/);
});
test('browser output registers one lazy factory using host React and official icons', () => {
  const registrations = [];
  vm.runInNewContext(read('lib/client.js'), { window: { __ModuleLoader__: { load: item => registrations.push(item) } } });
  assert.equal(registrations.length, 1); assert.equal(registrations[0].id, manifest.name);
  const requested = [];
  const plugin = registrations[0].factory(id => { requested.push(id); return { Component: class {}, createElement() {} }; });
  assert.deepEqual(requested, ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']);
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'));
  assert.doesNotMatch(read('lib/client.js'), /M4 6L7\.29289|__WhaleOfficialIconTest|react\.production\.min/); assert.deepEqual(Array.from(plugin.inject), ['slots', 'sessions', 'connection', 'locale', 'remote']);
  const slots = [];
  plugin.apply({ slots: { inject(name, fn) { assert.equal(name, 'shell.overlay'); fn(); }, register(options, component) { slots.push(options); assert.equal(typeof component, 'function'); return () => {}; } } });
  assert.equal(slots.length, 1); assert.equal(slots[0].name, 'shell.overlay'); assert.equal(slots[0].id, 'whale-pet');
});
test('pet has no extra status indicator dot in source or generated bundle', () => {
  for (const file of ['src/widget.js', 'src/pet.css', 'lib/client.js']) {
    assert.doesNotMatch(read(file), /class="indicator"|\.indicator\b/);
  }
});
test('host contributes only a read-only boundary service and owned listener', async () => {
  const host = await import('../lib/index.js');
  assert.equal(host.name, 'whalePet'); assert.deepEqual(host.inject, ['agents']);
  let service, cleanup;
  host.apply({ get: () => ({ list: () => [], roots: () => [] }),
    provide(key, value) { assert.equal(key, 'whalePet'); service = value; },
    on(event, callback, options) { assert.equal(event, 'session/event'); assert.equal(options.global, true); assert.equal(typeof callback, 'function'); },
    effect(factory) { cleanup = factory(); },
  });
  assert.equal(service.typertRemote.service, service);
  const stream = service.watch(new AbortController().signal);
  assert.equal((await stream.next()).value.type, 'baseline'); cleanup();
  assert.equal((await stream.next()).done, true);
  assert.doesNotMatch(read('lib/index.js'), /from ['"](?:node:)?(?:fs|http|https|child_process)|createServer|writeFile|fetch\(/);
});
test('embedded bubble fonts ship with OFL notices and no runtime font dependency', () => {
  let total = 0;
  for (const language of ['en', 'zh']) {
    const bytes = fs.readFileSync(path.join(root, `assets/fonts/bubble-${language}.woff2`));
    assert.equal(bytes.toString('ascii', 0, 4), 'wOF2'); total += bytes.length;
  }
  assert.ok(total < 150000, 'Only a compact bubble subset belongs in the runtime');
  const notices = fs.readdirSync(path.join(root, 'assets/fonts')).filter(name => /OFL|LICENSE/i.test(name));
  assert.ok(notices.length >= 2);
  for (const notice of notices) assert.match(read(`assets/fonts/${notice}`), /SIL OPEN FONT LICENSE/);
  assert.ok(manifest.files.includes('FONT-LICENSES.md'));
  assert.match(read('FONT-LICENSES.md'), /Fredoka/); assert.match(read('FONT-LICENSES.md'), /ZCOOL/);
  assert.match(read('lib/client.js'), /data:font\/woff2;base64,/);
});
test('six inert SVGs and offline preview are present, without source paths', () => {
  for (const name of ['working', 'celebrate', 'waiting', 'resting', 'sleeping', 'error']) {
    const svg = read(`assets/${name}.svg`); assert.match(svg, /^<svg/); assert.doesNotMatch(svg, /<script|<foreignObject|\son\w+=|\shref=/i);
  }
  assert.doesNotMatch(read('lib/client.js'), /\/Users\/|fetch\(|XMLHttpRequest|dsh-pet-research|bridge-build-probe/);
  assert.doesNotMatch(read('lib/remote.js'), /\/Users\/|dsh-pet-research|bridge-build-probe/);
  const preview = read('preview/index.html');
  assert.doesNotMatch(preview, /<script[^>]+src=|__PACKAGE_VERSION__/);
  assert.ok(preview.includes(`DSH PLUGIN / ${manifest.version}`));
  assert.doesNotMatch(read('tools/build.mjs'), /tools\/fixtures|dsh-chevron\.svg/);
  assert.ok(read('preview/runtime.js').includes('M 4 6 L 8 10 L 12 6'));
  assert.ok(!read('lib/client.js').includes('M 4 6 L 8 10 L 12 6'));
});
