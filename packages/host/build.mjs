// Bundles the host, the MCP shim and all their dependencies into self-contained files in dist/,
// so Nova AI for VS Code and nova-ai-cli can ship them as-is (see scripts/vendor.mjs).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
    entryPoints: ['src/cli.ts', 'src/mcp.ts'],
    outdir: 'dist',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    define: { __NOVA_HOST_VERSION__: JSON.stringify(pkg.version) },
    // Some bundled dependencies are CommonJS and call require() for Node built-ins.
    banner: { js: "#!/usr/bin/env node\nimport { createRequire as __novaCreateRequire } from 'node:module';\nconst require = __novaCreateRequire(import.meta.url);" },
    minify: true,
    legalComments: 'eof',
    logLevel: 'info'
});
