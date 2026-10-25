import { describe, expect, it } from 'vitest';
import { sessionIdOf, withoutImages } from '../src/lib/sessions';

describe('saved chats', () => {
    it('drops screenshots from tool results and model history', () => {
        const session = {
            items: [{ kind: 'tool', result: { content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] } }],
            history: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }]
        };
        expect(JSON.stringify(withoutImages(session))).not.toContain('AAAA');
        expect(withoutImages(session).items[0].result.content[0]).toEqual({ type: 'text', text: 'ok' });
    });

    it('recognizes session storage keys', () => {
        expect(sessionIdOf('session:abc')).toBe('abc');
        expect(sessionIdOf('settings')).toBeUndefined();
    });
});
