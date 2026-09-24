// Rebuild only bridge artifacts. No app/profile access. Tooling is development-only.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = new URL('../', import.meta.url);
// Resolve only this publication checkout's pinned development dependencies.
const requireTooling = createRequire(new URL('package.json', root));
const { build } = requireTooling('esbuild');
const zodDirectory = path.dirname(requireTooling.resolve('zod/package.json'));
if (requireTooling('zod/package.json').version !== '4.4.3' || requireTooling('esbuild/package.json').version !== '0.25.12') throw new Error('Bridge rebuild requires zod@4.4.3 and esbuild@0.25.12');
const zodLicense = await fs.readFile(path.join(zodDirectory, 'LICENSE'), 'utf8');
await build({
  entryPoints: [fileURLToPath(new URL('./bridge-contract-source.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('lib/remote.js', root)),
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  // Keep generated source comments relative even when invoked from another cwd.
  absWorkingDir: fileURLToPath(root),
  minify: false, legalComments: 'inline',
  banner: { js: '// Generated from tools/bridge-contract-source.mjs; includes Zod, not DSH implementation code.\n/* Zod 4.4.3 license:\n' + zodLicense + '\n*/' },
});
// Remove the obsolete prerelease version helper during incremental rebuilds.
await fs.rm(new URL('lib/version.js', root), { force: true });
await fs.copyFile(new URL('src/host-bridge.js', root), new URL('lib/index.js', root));
console.log('Built strict browser/Host contract and Host entry.');
