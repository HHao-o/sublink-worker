import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const app = createApp({ kv: new MemoryKVAdapter(), assetFetcher: null, logger: console, config: {} });

const BACK = [
    'socks5://user:secret@disp.example.com:8001#back-socks',
    'vless://11111111-1111-1111-1111-111111111111@1.2.3.4:443?type=tcp&security=tls&sni=example.com#back-vless'
].join('\n');

const FRONT = 'ss://YWVzLTEyOC1nY206cGFzcw==@front.example.com:8443#front-ss';

async function parse(body) {
    const res = await app.request('http://x/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { res, json: res.ok ? await res.json() : null };
}

describe('POST /parse', () => {
    it('lists parsed nodes with the fields the UI needs', async () => {
        const { res, json } = await parse({ config: BACK });

        expect(res.status).toBe(200);
        const names = json.proxies.map(p => p.tag);
        expect(names).toEqual(['back-socks', 'back-vless']);

        const socks = json.proxies.find(p => p.tag === 'back-socks');
        expect(socks).toMatchObject({
            type: 'socks',
            server: 'disp.example.com',
            port: 8001,
            role: 'back'
        });
    });

    it('never exposes credentials', async () => {
        const { json } = await parse({ config: BACK });

        const serialized = JSON.stringify(json);
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('11111111-1111-1111-1111-111111111111');
        expect(serialized).not.toContain('YWVzLTEyOC1nY206cGFzcw');
    });

    it('marks front and back nodes in chain mode', async () => {
        const { json } = await parse({ config: BACK, chain: FRONT });

        const front = json.proxies.filter(p => p.role === 'front');
        const back = json.proxies.filter(p => p.role === 'back');

        expect(front.map(p => p.tag)).toEqual(['front-ss']);
        expect(back.map(p => p.tag)).toEqual(['back-socks', 'back-vless']);
    });

    it('rejects a request without config', async () => {
        const res = await app.request('http://x/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        expect(res.status).toBe(400);
    });

    it('returns an empty list for input with no nodes', async () => {
        const { res, json } = await parse({ config: 'not a node' });

        expect(res.status).toBe(200);
        expect(json.proxies).toEqual([]);
    });
});
