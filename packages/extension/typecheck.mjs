// Runs svelte-check and ignores problems inside src/lib/client-lib, the Nova platform's UI library
// (a git submodule): it is type-checked for SvelteKit, not for this extension.
import { spawnSync } from 'node:child_process';

const run = spawnSync('npx', ['svelte-check', '--tsgo', '--tsconfig', './tsconfig.json', '--output', 'machine'], { encoding: 'utf8' });
const problems = (run.stdout ?? '').split('\n').filter((line) => /\b(ERROR|WARNING)\b/.test(line) && !line.includes('src/lib/client-lib/'));
const errors = problems.filter((line) => line.includes(' ERROR '));
for (const line of problems) console.log(line);
if (run.status !== 0 && run.stdout.trim() === '') {
    console.error(run.stderr);
    process.exit(1);
}
console.log(`svelte-check: ${errors.length} errors, ${problems.length - errors.length} warnings (client-lib ignored)`);
process.exit(errors.length ? 1 : 0);
