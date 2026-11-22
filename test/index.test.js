import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const runtime = {
    kv: new MemoryKVAdapter(),
    assetFetcher: null,
    logger: console,
    config: {
        configTtlSeconds: 60,
        shortLinkTtlSeconds: null
    }
};

const app = createApp(runtime);

describe('Worker', () => {
    it('responds with HTML on root path', async () => {
        const res = await app.request('http://example.com/');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        const text = await res.text();
        expect(text).toContain('<!DOCTYPE html>');
    });

    it('links to Chinese from the English homepage and preserves configId', async () => {
        const res = await app.request('http://example.com/?configId=clash_saved', {
            headers: { 'Accept-Language': 'en-GB,en;q=0.9' }
        });
        const text = await res.text();

        expect(text).toContain('<html lang="en-US"');
        expect(text).toContain('Input Source');
        expect(text).toContain('href="?configId=clash_saved&amp;lang=zh-CN" lang="zh-CN"');
    });

    it('uses the chosen language over the browser language and links back to English', async () => {
        const res = await app.request('http://example.com/?lang=zh-CN', {
            headers: { 'Accept-Language': 'en-US' }
        });
        const text = await res.text();

        expect(text).toContain('<html lang="zh-CN"');
        expect(text).toContain('输入源');
        expect(text).toContain('href="?lang=en-US" lang="en-US"');
    });

    it('responds with 404 for unknown paths', async () => {
        const res = await app.request('http://example.com/unknown-path');
        expect(res.status).toBe(404);
    });
});
