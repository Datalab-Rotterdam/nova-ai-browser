// Checks the Chrome Web Store and Edge Add-ons credentials without uploading or publishing anything,
// so a bad secret shows up before a release instead of during one. Uses the same environment
// variables as publish-chrome.mjs and publish-edge.mjs; a store whose variables are all unset is skipped.
//
// Chrome: gets an access token and reads the item's status (which also proves the extension and
//   publisher IDs belong to these credentials).
// Edge: the API has no read-only call for a product, so it asks for the status of an operation that
//   does not exist. 404 means the API key and client ID were accepted; 401/403 means they were not.
//   The product ID itself can only be confirmed by a real upload.
//
// Usage: node scripts/check-store-credentials.mjs
import chromeWebstoreUpload from 'chrome-webstore-upload';
import { readStoreEnv } from './store-env.mjs';

const env = {};
const CHROME = ['EXTENSION_ID', 'PUBLISHER_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'];
const EDGE = ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'];
const EDGE_API = 'https://api.addons.microsoftedge.microsoft.com/v1';

let failed = false;
const ok = (store, message) => console.log(`✅ ${store}: ${message}`);
const fail = (store, message) => {
    failed = true;
    console.error(`❌ ${store}: ${message}`);
};

/**
 * Reads a store's variables into `env` (trimmed). Returns null when none are set, false (and reports)
 * when some are missing or malformed, true otherwise.
 */
function configured(store, names) {
    const { values, missing, warnings, problems } = readStoreEnv(names);
    Object.assign(env, values);
    if (missing.length === names.length) {
        console.log(`➖ ${store}: skipped, none of ${names.join(', ')} is set`);
        return null;
    }
    for (const warning of warnings) console.warn(`⚠️ ${store}: ${warning}`);
    if (missing.length) fail(store, `missing ${missing.join(', ')}`);
    for (const problem of problems) fail(store, problem);
    return !missing.length && !problems.length;
}

function revision(status) {
    if (!status) return 'none';
    const versions = (status.distributionChannels ?? []).map((c) => c.crxVersion).filter(Boolean);
    return `${status.state}${versions.length ? ` (${versions.join(', ')})` : ''}`;
}

async function checkChrome() {
    if (!configured('Chrome Web Store', CHROME)) return;
    const store = chromeWebstoreUpload({
        extensionId: env.EXTENSION_ID,
        publisherId: env.PUBLISHER_ID,
        clientId: env.CLIENT_ID,
        clientSecret: env.CLIENT_SECRET,
        refreshToken: env.REFRESH_TOKEN
    });
    // Asked directly rather than through the library, which drops Google's error_description.
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
            client_id: env.CLIENT_ID,
            client_secret: env.CLIENT_SECRET,
            refresh_token: env.REFRESH_TOKEN,
            grant_type: 'refresh_token'
        })
    });
    const grant = await response.json().catch(() => ({}));
    if (!response.ok || !grant.access_token) {
        const google = [grant.error, grant.error_description].filter(Boolean).join(': ') || `HTTP ${response.status}`;
        fail('Chrome Web Store', `could not get an access token: ${google}`);
        if (grant.error === 'invalid_grant') {
            console.error('   The client ID and secret were accepted; the refresh token was not (revoked, or made with another client).');
            console.error('   Make a new one with this same client ID and secret.');
        } else if (grant.error === 'invalid_client') {
            console.error('   CLIENT_ID or CLIENT_SECRET is wrong.');
        }
        return;
    }
    const token = grant.access_token;
    const scopes = grant.scope?.split(' ') ?? [];
    if (grant.scope && !scopes.some((scope) => scope.startsWith('https://www.googleapis.com/auth/chromewebstore'))) {
        fail('Chrome Web Store', `the refresh token has no Chrome Web Store scope (it has: ${grant.scope})`);
        return;
    }
    try {
        const status = await store.get(token);
        ok('Chrome Web Store', `item ${status.itemId ?? env.EXTENSION_ID} readable`);
        console.log(`   published: ${revision(status.publishedItemRevisionStatus)}`);
        console.log(`   submitted: ${revision(status.submittedItemRevisionStatus)}`);
        if (status.takenDown) fail('Chrome Web Store', 'the item has been taken down for a policy violation');
        else if (status.warned) console.warn('   ⚠️ the item has a policy warning; see the developer dashboard');
        const state = status.submittedItemRevisionStatus?.state;
        if (state === 'PENDING_REVIEW' || state === 'STAGED') {
            console.warn(`   ⚠️ a release now would skip the Chrome upload (${state})`);
        }
    } catch (error) {
        fail('Chrome Web Store', `token works, but item status failed (EXTENSION_ID, PUBLISHER_ID): ${error.message}`);
    }
}

async function checkEdge() {
    if (!configured('Edge Add-ons', EDGE)) return;
    const url = `${EDGE_API}/products/${encodeURIComponent(env.EDGE_PRODUCT_ID)}/submissions/operations/${crypto.randomUUID()}`;
    const response = await fetch(url, { headers: { Authorization: `ApiKey ${env.EDGE_API_KEY}`, 'X-ClientID': env.EDGE_CLIENT_ID } });
    const body = (await response.text()).slice(0, 500);
    if (response.status === 404) {
        ok('Edge Add-ons', 'API key and client ID accepted (the product ID is only checked by a real upload)');
    } else if (response.status === 401 || response.status === 403) {
        fail('Edge Add-ons', `API key or client ID rejected (${response.status}); create new credentials in Partner Center. ${body}`);
    } else {
        fail('Edge Add-ons', `unexpected answer ${response.status}: ${body}`);
    }
}

await checkChrome();
await checkEdge().catch((error) => fail('Edge Add-ons', error.message));
process.exit(failed ? 1 : 0);
