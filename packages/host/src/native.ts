/**
 * Chrome native messaging over stdio: each message is a 32-bit length in native byte order
 * (little-endian on every platform Chrome supports) followed by UTF-8 JSON. Messages from
 * the host to the browser may be at most 1 MB.
 */
import type { Readable, Writable } from 'node:stream';

export const MAX_HOST_MESSAGE = 1024 * 1024;

export function encodeMessage(message: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length > MAX_HOST_MESSAGE) {
        throw new Error(`Native message too large (${body.length} bytes, max ${MAX_HOST_MESSAGE}).`);
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
}

/** Incremental decoder: feed chunks, get complete messages. */
export class MessageDecoder {
    private buffer = Buffer.alloc(0);

    public push(chunk: Buffer): unknown[] {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const messages: unknown[] = [];
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32LE(0);
            if (this.buffer.length < 4 + length) break;
            messages.push(JSON.parse(this.buffer.subarray(4, 4 + length).toString('utf8')));
            this.buffer = this.buffer.subarray(4 + length);
        }
        return messages;
    }
}

export class NativeChannel {
    private readonly decoder = new MessageDecoder();
    private readonly listeners = new Set<(message: Record<string, unknown>) => void>();

    public constructor(private readonly input: Readable, private readonly output: Writable, onClose: () => void) {
        input.on('data', (chunk: Buffer) => {
            for (const message of this.decoder.push(chunk)) {
                for (const listener of this.listeners) listener(message as Record<string, unknown>);
            }
        });
        // The browser closes stdin when the extension disconnects or the browser quits.
        input.on('end', onClose);
        input.on('close', onClose);
    }

    public onMessage(listener: (message: Record<string, unknown>) => void): void {
        this.listeners.add(listener);
    }

    public send(message: unknown): void {
        this.output.write(encodeMessage(message));
    }
}
