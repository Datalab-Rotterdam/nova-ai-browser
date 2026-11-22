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

const env = process.env;
const CHROME = ['EXTENSION_ID', 'PUBLISHER_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'];
const EDGE = ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'];
const EDGE_API = 'https://api.addons.microsoftedge.microsoft.com/v1';

let failed = false;
const ok = (store, message) => console.log(`✅ ${store}: ${message}`);
const fail = (store, message) => {
    failed = true;
    console.error(`❌ ${store}: ${message}`);
};

/** Returns false (and reports) when some but not all of a store's variables are set; null when none are. */
function configured(store, names) {
    const missing = names.filter((name) => !env[name]);
    if (missing.length === names.length) {
        console.log(`➖ ${store}: skipped, none of ${names.join(', ')} is set`);
        return null;
    }
    if (missing.length) {
        fail(store, `missing ${missing.join(', ')}`);
        return false;
    }
    return true;
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
    let token;
    try {
        token = await store.fetchToken();
    } catch (error) {
        fail('Chrome Web Store', `could not get an access token (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN): ${error.message}`);
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
