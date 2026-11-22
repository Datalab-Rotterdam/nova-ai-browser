// Reads the store secrets for publish-chrome.mjs, publish-edge.mjs and check-store-credentials.mjs.
// A secret pasted into GitHub often ends in a newline, which breaks the request (Edge answers
// "HTTP Error 400. The request URL is invalid", Google answers invalid_grant), so values are trimmed,
// with a warning naming the secret. Problems are reported without the value itself.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHAPES = {
    EXTENSION_ID: [/^[a-p]{32}$/, '32 letters a-p (the item ID in the developer dashboard URL)'],
    EDGE_PRODUCT_ID: [GUID, 'a GUID (Product ID under Extension identity in Partner Center)'],
    EDGE_CLIENT_ID: [GUID, 'a GUID (Client ID under Publish API in Partner Center)']
};

/**
 * Returns the trimmed values of `names` from the environment, the names that are unset, and
 * problems: values that had surrounding whitespace (warnings) or do not look like the store's IDs.
 */
export function readStoreEnv(names, env = process.env) {
    const values = {};
    const missing = [];
    const warnings = [];
    const problems = [];
    for (const name of names) {
        const raw = env[name] ?? '';
        const value = raw.trim();
        if (!value) {
            missing.push(name);
            continue;
        }
        if (value !== raw) warnings.push(`${name} had spaces or a line break around it (trimmed); save the secret again without them`);
        const shape = SHAPES[name];
        if (shape && !shape[0].test(value)) problems.push(`${name} is not ${shape[1]}; it has ${value.length} characters`);
        values[name] = value;
    }
    return { values, missing, warnings, problems };
}
