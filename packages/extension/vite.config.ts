import { crx } from '@crxjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import manifest from './manifest.config.ts';

export default defineConfig({
    plugins: [svelte(), crx({ manifest })],
    build: {
        target: 'chrome116',
        rollupOptions: {
            input: {
                permission: 'src/permission/index.html'
            }
        }
    },
    server: {
        port: 5199,
        strictPort: true,
        cors: { origin: [/chrome-extension:\/\//] }
    }
});
