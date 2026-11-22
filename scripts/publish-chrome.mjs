// Uploads release/nova-ai-browser-extension.zip (from `npm run package:extension`) to the Chrome Web
// Store and publishes it, with the Chrome Web Store API v2:
// https://developer.chrome.com/docs/webstore/using-api
//
// Needs EXTENSION_ID, PUBLISHER_ID, CLIENT_ID, CLIENT_SECRET and REFRESH_TOKEN. The first version of an
// item has to be uploaded by hand in the developer dashboard; the API only updates.
//
// While an earlier version is still in review (or approved and waiting to be published by hand), the
// store does not take a new one. The upload is then skipped with a warning instead of failing the
// release: the zip is attached to the GitHub release, to upload in the dashboard once review is done.
//
// Usage: node scripts/publish-chrome.mjs [path/to/package.zip] [--no-publish]
//   --no-publish  upload only and leave publishing to the developer dashboard.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chromeWebstoreUpload from 'chrome-webstore-upload';
import { readStoreEnv } from './store-env.mjs';

const MAX_AWAIT_UPLOAD_SECONDS = 300;
const BLOCKING_STATES = {
    PENDING_REVIEW: 'is still in review',
    STAGED: 'is approved and waiting to be published in the developer dashboard'
};

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const publish = !args.includes('--no-publish');
const zipPath = args.find((arg) => !arg.startsWith('--')) ?? join(root, 'release/nova-ai-browser-extension.zip');

const { values: env, missing, warnings, problems } = readStoreEnv(['EXTENSION_ID', 'PUBLISHER_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN']);
for (const warning of warnings) console.warn(`Warning: ${warning}`);
if (missing.length || problems.length) {
    if (missing.length) console.error(`Chrome Web Store upload needs ${missing.join(', ')}.`);
    for (const problem of problems) console.error(problem);
    process.exit(1);
}
if (!existsSync(zipPath)) {
    console.error(`Missing ${zipPath}; run npm run package:extension first.`);
    process.exit(1);
}

/** The API's error message plus its details, for a CWSError or anything else. */
function describe(error) {
    if (!(error instanceof Error)) return String(error);
    const details = [error.cause?.details ?? []].flat().map((d) => (typeof d === 'string' ? d : d?.message ?? d?.reason)).filter(Boolean);
    return [error.message, ...details].join('\n  - ');
}

try {
    const store = chromeWebstoreUpload({
        extensionId: env.EXTENSION_ID,
        publisherId: env.PUBLISHER_ID,
        clientId: env.CLIENT_ID,
        clientSecret: env.CLIENT_SECRET,
        refreshToken: env.REFRESH_TOKEN
    });
    const token = await store.fetchToken();

    const status = await store.get(token);
    if (status.takenDown) throw new Error('The item has been taken down for a policy violation; see the developer dashboard.');
    const submitted = status.submittedItemRevisionStatus;
    const blocking = BLOCKING_STATES[submitted?.state];
    if (blocking) {
        const version = submitted.distributionChannels?.[0]?.crxVersion;
        console.warn(
            `Chrome Web Store upload skipped: version ${version ?? '(unknown)'} ${blocking}. ` +
                `Upload this release's zip in the developer dashboard once that is done.`
        );
        process.exit(0);
    }

    console.log(`Uploading ${zipPath} to Chrome Web Store item ${env.EXTENSION_ID}`);
    const upload = await store.uploadExisting(zipPath, token, MAX_AWAIT_UPLOAD_SECONDS);
    if (upload.uploadState !== 'SUCCEEDED') {
        throw new Error(`Upload ended as ${upload.uploadState ?? 'unknown'}: ${JSON.stringify(upload)}`);
    }
    console.log(`Uploaded version ${upload.crxVersion ?? ''}`.trim());

    if (!publish) {
        console.log('Not published (--no-publish); publish it in the developer dashboard.');
    } else {
        const published = await store.publish('DEFAULT_PUBLISH', token);
        if (published.state === 'REJECTED') throw new Error(`Publish rejected: ${JSON.stringify(published)}`);
        console.log(`Submitted for publishing: ${published.state ?? 'unknown state'}`);
    }
} catch (error) {
    console.error(`Chrome Web Store upload failed:\n  - ${describe(error)}`);
    process.exit(1);
}
