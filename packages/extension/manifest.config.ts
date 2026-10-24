import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

/**
 * Public half of the development signing key. It pins the extension ID to
 * lnoimoijcjpcebjepmenoepmhbdgnipo so the native host can trust it (allowed_origins).
 * The Chrome Web Store build (`vite build --mode store`) leaves it out: the store rejects a key and
 * assigns its own ID.
 */
const DEV_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtzanWbsVRQilYoaUPjnoqyFJ7cR+klqsQYBnOcNRFh8EeKhH84R4cKPFsb9BTu/rhu9Kx75juuFWXnxZpIpf4yO3IB06oB/e5ikkuTj/TT7NEHjsFjYISwpnbvtKKujgqkd+H2M5d9flgrChqemyxt1VE72v9gdqs3zsSn+3vha+PO3PGNXWOKKY4ed0CHbr94HR9QoNVTNNGI4udaXg2DGivOj02aX0EN3WbLRbq/jRN0TEFputJHEvtn5bZAOvkfTzqdN6OJdgHpNgTqjKh3L57srlTtgb2s0oS9AXUGMbUKX9x0wSZC7SN+D+8RRQFoxgfn8PbJQRX9mTuzC4FQIDAQAB';

export default defineManifest(({ mode }) => ({
    manifest_version: 3,
    name: 'Nova AI',
    description: 'Let Nova AI use your browser: it clicks, types and reads pages while you watch its cursor.',
    version: pkg.version,
    minimum_chrome_version: '116',
    ...(mode === 'store' ? {} : { key: DEV_PUBLIC_KEY }),
    icons: {
        16: 'icons/icon-16.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png'
    },
    action: { default_title: 'Open Nova AI' },
    background: { service_worker: 'src/background/index.ts', type: 'module' },
    side_panel: { default_path: 'src/sidepanel/index.html' },
    permissions: [
        'sidePanel',
        'storage',
        'scripting',
        'debugger',
        'tabs',
        'tabGroups',
        'nativeMessaging'
    ],
    host_permissions: ['<all_urls>'],
    content_scripts: [
        {
            matches: ['http://*/*', 'https://*/*', 'file:///*'],
            js: ['src/content/a11y.iife.ts'],
            run_at: 'document_start'
        },
        {
            matches: ['http://*/*', 'https://*/*', 'file:///*'],
            js: ['src/content/overlay.iife.ts'],
            run_at: 'document_idle'
        }
    ],
    commands: {
        _execute_action: {
            suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
            description: 'Open Nova AI'
        }
    }
}));
