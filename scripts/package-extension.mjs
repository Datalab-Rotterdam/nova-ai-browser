// Checks the Chrome Web Store build (packages/extension/dist-store, from `npm run build:store`)
// and zips it into release/nova-ai-browser-extension.zip for upload. Fails on anything the store
// would reject, so CI catches it before a release does.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'packages/extension/dist-store');
const out = join(root, 'release');
const zip = join(out, 'nova-ai-browser-extension.zip');

const problems = [];
const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
    console.error(`Missing ${manifestPath}; run npm run build:store first.`);
    process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'packages/extension/package.json'), 'utf8'));

if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if ('key' in manifest) problems.push('manifest has a "key"; the store rejects it (build with --mode store)');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version) || manifest.version.split('.').some((part) => Number(part) > 65535)) {
    problems.push(`version "${manifest.version}" is not 1-4 dot-separated integers up to 65535`);
}
if (manifest.version !== pkg.version) problems.push(`manifest version ${manifest.version} differs from package.json ${pkg.version}`);
if (!manifest.name || manifest.name.length > 75) problems.push('name must be 1-75 characters');
if (!manifest.description || manifest.description.length > 132) problems.push('description must be 1-132 characters');
if (!manifest.icons?.['128']) problems.push('a 128px icon is required');

// Every file the manifest points at must be in the package.
const referenced = [
    ...Object.values(manifest.icons ?? {}),
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...(manifest.content_scripts ?? []).flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])])
].filter(Boolean);
for (const file of referenced) {
    if (!existsSync(join(dist, file))) problems.push(`manifest references missing file ${file}`);
}

if (problems.length) {
    console.error(`Chrome Web Store package check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
}

rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '*.map', '-x', '.*'], { cwd: dist, stdio: 'inherit' });
console.log(`Packaged Nova AI ${manifest.version} for the Chrome Web Store: ${zip} (${Math.round(statSync(zip).size / 1024)} KiB)`);
