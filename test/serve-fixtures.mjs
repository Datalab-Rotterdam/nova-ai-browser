// Serves test/fixtures over HTTP for e2e tests and manual testing (npm run fixtures).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./fixtures/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

export function serveFixtures(port = 0) {
    const server = createServer(async (req, res) => {
        const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
        const file = join(ROOT, path || 'index.html');
        if (!file.startsWith(ROOT)) {
            res.writeHead(403).end();
            return;
        }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
        } catch {
            res.writeHead(404).end('not found');
        }
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const server = await serveFixtures(Number(process.env.PORT ?? 5174));
    console.log(`Fixtures on http://127.0.0.1:${server.address().port}/`);
}
