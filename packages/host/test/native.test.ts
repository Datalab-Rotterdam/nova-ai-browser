import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeMessage, MAX_HOST_MESSAGE, MessageDecoder, NativeChannel } from '../src/native';
import { onJsonLines, RpcClient } from '../src/rpc';

describe('native messaging framing', () => {
    it('round-trips messages split across chunks', () => {
        const a = encodeMessage({ type: 'hello', text: 'héllo' });
        const b = encodeMessage({ type: 'tool/call', id: '1' });
        const both = Buffer.concat([a, b]);
        const decoder = new MessageDecoder();
        expect(decoder.push(both.subarray(0, 3))).toEqual([]);
        expect(decoder.push(both.subarray(3, a.length + 5))).toEqual([{ type: 'hello', text: 'héllo' }]);
        expect(decoder.push(both.subarray(a.length + 5))).toEqual([{ type: 'tool/call', id: '1' }]);
    });

    it('uses a little-endian length prefix', () => {
        const frame = encodeMessage({ a: 1 });
        expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    });

    it('refuses messages over the 1 MB host limit', () => {
        expect(() => encodeMessage({ data: 'x'.repeat(MAX_HOST_MESSAGE) })).toThrow(/too large/);
    });

    it('NativeChannel reads and writes frames and reports close', async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        let closed = false;
        const channel = new NativeChannel(input, output, () => (closed = true));
        const received: unknown[] = [];
        channel.onMessage((message) => received.push(message));

        input.write(encodeMessage({ type: 'ping' }));
        channel.send({ type: 'pong' });
        await new Promise((resolve) => setImmediate(resolve));
        expect(received).toEqual([{ type: 'ping' }]);
        expect(new MessageDecoder().push(output.read() as Buffer)).toEqual([{ type: 'pong' }]);

        input.end();
        await new Promise((resolve) => setImmediate(resolve));
        expect(closed).toBe(true);
    });
});

describe('RpcClient', () => {
    let dir: string | undefined;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('matches responses to requests over a socket', async () => {
        dir = mkdtempSync(join(tmpdir(), 'nova-rpc-'));
        const path = process.platform === 'win32' ? `\\\\.\\pipe\\nova-rpc-test-${process.pid}` : join(dir, 's.sock');
        const server = createServer((socket) => {
            onJsonLines(socket, (value) => {
                const request = value as { id: number; method: string };
                // Answer out of order to prove ids are matched.
                setTimeout(() => socket.write(`${JSON.stringify({ id: request.id, result: { ok: true, version: String(request.id) } })}\n`), request.id === 1 ? 30 : 0);
            });
        });
        await new Promise<void>((resolve) => server.listen(path, resolve));

        const client = await RpcClient.connect(path);
        const [first, second] = await Promise.all([client.request({ method: 'ping' }, 1000), client.request({ method: 'ping' }, 1000)]);
        expect(first).toEqual({ id: 1, result: { ok: true, version: '1' } });
        expect(second).toEqual({ id: 2, result: { ok: true, version: '2' } });
        client.close();
        server.close();
    });
});
