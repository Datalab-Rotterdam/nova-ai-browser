// Sets one version on the root and every workspace package, including the exact pins between
// them, so the extension manifest, the host and the protocol always ship the same number.
// semantic-release runs it in prepare. Usage: node scripts/set-version.mjs <version>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
// Chrome only accepts one to four dot-separated integers, so no prerelease or build suffix.
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    console.error(`Usage: node scripts/set-version.mjs <major.minor.patch> (got ${version ?? 'nothing'})`);
    process.exit(2);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [
    join(root, 'package.json'),
    ...readdirSync(join(root, 'packages')).map((name) => join(root, 'packages', name, 'package.json'))
];
const manifests = files.map((file) => ({ file, pkg: JSON.parse(readFileSync(file, 'utf8')) }));
const workspaceNames = new Set(manifests.map(({ pkg }) => pkg.name));

for (const { file, pkg } of manifests) {
    pkg.version = version;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const name of Object.keys(pkg[field] ?? {})) {
            if (workspaceNames.has(name)) pkg[field][name] = version;
        }
    }
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(`Set version ${version} on ${manifests.length} packages`);
