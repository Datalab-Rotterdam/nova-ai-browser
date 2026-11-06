import { crx } from '@crxjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));
import manifest from './manifest.config.ts';

export default defineConfig({
    plugins: [svelte(), crx({ manifest })],
    resolve: {
        // client-lib is linked from the Nova platform checkout; keep its files under this project
        // so they share one copy of Svelte.
        preserveSymlinks: true,
        alias: [
            { find: '$app/environment', replacement: src('./src/lib/shims/app-environment.ts') },
            { find: '$app/state', replacement: src('./src/lib/shims/app-state.ts') },
            { find: '$app/navigation', replacement: src('./src/lib/shims/app-navigation.ts') },
            { find: '$app/forms', replacement: src('./src/lib/shims/app-forms.ts') },
            { find: '@sourceregistry/sveltekit-service-manager/client', replacement: src('./src/lib/shims/service-manager-client.ts') },
            { find: /^\$lib\//, replacement: src('./src/lib/') }
        ]
    },
    build: {
        target: 'chrome116',
        rollupOptions: {
            input: {
                permission: 'src/permission/index.html',
                options: 'src/options/index.html'
            }
        }
    },
    server: {
        port: 5199,
        strictPort: true,
        cors: { origin: [/chrome-extension:\/\//] }
    }
});
