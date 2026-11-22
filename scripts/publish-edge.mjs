// Uploads release/nova-ai-browser-extension.zip (from `npm run package:extension`) to Microsoft Edge
// Add-ons and submits it for certification, with the Edge Add-ons API v1.1:
// https://learn.microsoft.com/microsoft-edge/extensions-chromium/publish/api/using-addons-api
//
// Needs EDGE_PRODUCT_ID (the product GUID from Partner Center, not the extension's CRX ID),
// EDGE_CLIENT_ID and EDGE_API_KEY (Partner Center, Microsoft Edge, Publish API; keys expire).
// The first version of a product has to be published by hand in Partner Center; the API only updates.
//
// Usage: node scripts/publish-edge.mjs [path/to/package.zip] [--no-submit]
//   --no-submit  upload to the draft only and leave the submission to Partner Center.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const API = 'https://api.addons.microsoftedge.microsoft.com/v1';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
// A submission that is still in review (or being unpublished) blocks a new one. That is not a broken
// release: the package stays in the draft and can be submitted from Partner Center once review is done.
const PENDING_REVIEW = new Set(['InProgressSubmission', 'UnpublishInProgress']);

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const submit = !args.includes('--no-submit');
const zipPath = args.find((arg) => !arg.startsWith('--')) ?? join(root, 'release/nova-ai-browser-extension.zip');

const { EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID: clientId, EDGE_API_KEY: apiKey } = process.env;
const missing = Object.entries({ EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID: clientId, EDGE_API_KEY: apiKey })
    .filter(([, value]) => !value)
    .map(([name]) => name);
if (missing.length) {
    console.error(`Edge Add-ons upload needs ${missing.join(', ')}.`);
    process.exit(1);
}

const headers = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
const product = `${API}/products/${encodeURIComponent(productId)}`;
const version = JSON.parse(readFileSync(join(root, 'packages/extension/package.json'), 'utf8')).version;

/** Sends a request that starts an operation and returns the operation ID from the Location header. */
async function start(url, init) {
    const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
    if (response.status !== 202) {
        throw new Error(`${init.method} ${url} answered ${response.status}: ${await response.text()}`);
    }
    // The docs give the operation ID as the Location value; take the last path segment in case it is a URL.
    const location = response.headers.get('location')?.trim();
    const operationId = location?.split('/').filter(Boolean).pop();
    if (!operationId) throw new Error(`${init.method} ${url} answered 202 without a Location header`);
    return operationId;
}

/** Polls an operation until it leaves InProgress; throws with the API's errors when it fails. */
async function wait(url, what) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
        const response = await fetch(url, { headers });
        const body = await response.text();
        if (!response.ok) throw new Error(`${what}: status check answered ${response.status}: ${body}`);
        const operation = JSON.parse(body);
        if (operation.status === 'Succeeded') return operation;
        if (operation.status !== 'InProgress') {
            if (operation.errorCode && PENDING_REVIEW.has(operation.errorCode)) return operation;
            const details = [operation.errorCode, operation.message, ...(operation.errors ?? []).map((e) => (typeof e === 'string' ? e : e?.message ?? JSON.stringify(e)))]
                .filter(Boolean)
                .join('\n  - ');
            throw new Error(`${what} failed (${operation.status ?? 'no status'}):\n  - ${details || body}`);
        }
        if (Date.now() > deadline) throw new Error(`${what} still in progress after ${POLL_TIMEOUT_MS / 60_000} minutes`);
        await sleep(POLL_INTERVAL_MS);
    }
}

try {
    const zip = readFileSync(zipPath);
    console.log(`Uploading ${zipPath} (${Math.round(zip.length / 1024)} KiB) to Edge Add-ons product ${productId}`);
    const uploadId = await start(`${product}/submissions/draft/package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip
    });
    const upload = await wait(`${product}/submissions/draft/package/operations/${uploadId}`, 'Package upload');
    console.log(upload.message ?? 'Package uploaded to the draft.');

    if (!submit) {
        console.log('Left as a draft (--no-submit); submit it in Partner Center.');
    } else {
        const publishId = await start(`${product}/submissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: `Nova AI ${version}. Release notes: https://github.com/Datalab-Rotterdam/nova-ai-browser/releases/tag/v${version}` })
        });
        const published = await wait(`${product}/submissions/operations/${publishId}`, 'Submission');
        if (published.status === 'Succeeded') {
            console.log(published.message ?? 'Submitted for certification.');
        } else {
            console.warn(
                `Not submitted (${published.errorCode}): an earlier submission is still in review. ` +
                    `The package is in the draft; submit it in Partner Center when the review is done.`
            );
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
