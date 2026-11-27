import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const runtime = () => ({ kv: new MemoryKVAdapter(), assetFetcher: null, logger: console, config: {} });

const BASE = [
    'vless://11111111-1111-1111-1111-111111111111@1.1.1.1:443?type=tcp&security=tls&sni=a.example.com#node-a',
    'socks5://user:pass@2.2.2.2:1080#node-b'
].join('\n');

const REPLACEMENT = 'vless://22222222-2222-2222-2222-222222222222@9.9.9.9:8443?type=tcp&security=tls&sni=b.example.com#ignored-name';

async function storeOverrides(app, overrides) {
    const res = await app.request('http://x/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides })
    });
    expect(res.status).toBe(200);
    return (await res.text()).trim();
}

describe('node overrides', () => {
    it('stores a table and returns its id', async () => {
        const app = createApp(runtime());
        const id = await storeOverrides(app, { 'node-a': REPLACEMENT });

        expect(id).toMatch(/^ov_[A-Za-z0-9]{8}$/);
    });

    it('replaces the node in Clash output while keeping its name', async () => {
        const app = createApp(runtime());
        const id = await storeOverrides(app, { 'node-a': REPLACEMENT });

        const res = await app.request(`http://x/clash?config=${encodeURIComponent(BASE)}&overridesId=${id}`);
        const config = yaml.load(await res.text());

        const replaced = config.proxies.find(p => p.name === 'node-a');
        expect(replaced.server).toBe('9.9.9.9');
        expect(replaced.port).toBe(8443);
        expect(replaced.uuid).toBe('22222222-2222-2222-2222-222222222222');

        const untouched = config.proxies.find(p => p.name === 'node-b');
        expect(untouched.server).toBe('2.2.2.2');
    });

    it('leaves the config unchanged for an unknown id', async () => {
        const app = createApp(runtime());

        const res = await app.request(`http://x/clash?config=${encodeURIComponent(BASE)}&overridesId=ov_doesnotexist`);
        const config = yaml.load(await res.text());

        expect(config.proxies.find(p => p.name === 'node-a').server).toBe('1.1.1.1');
    });

    it('ignores an override that cannot be parsed', async () => {
        const app = createApp(runtime());
        const id = await storeOverrides(app, { 'node-a': 'not-a-link' });

        const res = await app.request(`http://x/clash?config=${encodeURIComponent(BASE)}&overridesId=${id}`);
        const config = yaml.load(await res.text());

        expect(config.proxies.find(p => p.name === 'node-a').server).toBe('1.1.1.1');
    });

    it('applies overrides to sing-box output too', async () => {
        const app = createApp(runtime());
        const id = await storeOverrides(app, { 'node-a': REPLACEMENT });

        const res = await app.request(`http://x/singbox?config=${encodeURIComponent(BASE)}&overridesId=${id}`);
        const config = await res.json();
        const outbound = config.outbounds.find(o => o.tag === 'node-a');

        expect(outbound.server).toBe('9.9.9.9');
        expect(outbound.server_port).toBe(8443);
    });

    it('replaces a URI line in Xray output', async () => {
        const app = createApp(runtime());
        const id = await storeOverrides(app, { 'node-a': REPLACEMENT });

        const res = await app.request(`http://x/xray?config=${encodeURIComponent(BASE)}&overridesId=${id}`);
        const decoded = Buffer.from(await res.text(), 'base64').toString('utf8');

        expect(decoded).toContain('9.9.9.9:8443');
        expect(decoded).toContain('2.2.2.2:1080');
    });

    it('reports overridden nodes through /parse', async () => {
        const app = createApp(runtime());
        const res = await app.request('http://x/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: BASE, overrides: { 'node-a': REPLACEMENT } })
        });
        const json = await res.json();

        const node = json.proxies.find(p => p.tag === 'node-a');
        expect(node.server).toBe('9.9.9.9');
        expect(node.port).toBe(8443);
    });

    it('rejects an empty table', async () => {
        const app = createApp(runtime());

        const res = await app.request('http://x/overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overrides: {} })
        });

        expect(res.status).toBe(400);
    });

    it('keeps working through a short link', async () => {
        const app = createApp(runtime());
        const id = await storeOverrides(app, { 'node-a': REPLACEMENT });
        const longUrl = `https://x/clash?config=${encodeURIComponent(BASE)}&overridesId=${id}`;

        const shortRes = await app.request(`http://x/shorten-v2?url=${encodeURIComponent(longUrl)}`);
        const code = (await shortRes.text()).trim();

        const res = await app.request(`http://x/c/${code}`);
        const config = yaml.load(await res.text());

        expect(config.proxies.find(p => p.name === 'node-a').server).toBe('9.9.9.9');
    });
});
