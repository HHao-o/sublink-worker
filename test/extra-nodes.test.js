import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const runtime = () => ({ kv: new MemoryKVAdapter(), assetFetcher: null, logger: console, config: {} });

const BASE = 'vless://11111111-1111-1111-1111-111111111111@1.1.1.1:443?type=tcp&security=tls#base-node';
const EXTRA = 'socks5://user:pass@9.9.9.9:1080#extra-node';

async function parseBody(app, body) {
    const res = await app.request('http://x/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { res, json: res.ok ? await res.json() : null };
}

describe('extra nodes', () => {
    it('appends extra nodes to the Clash output', async () => {
        const app = createApp(runtime());
        const url = `http://x/clash?config=${encodeURIComponent(BASE)}&extra=${encodeURIComponent(EXTRA)}`;

        const res = await app.request(url);
        const config = yaml.load(await res.text());

        expect(config.proxies.map(p => p.name)).toEqual(['base-node', 'extra-node']);
    });

    it('marks extra nodes in the preview', async () => {
        const { json } = await parseBody(createApp(runtime()), { config: BASE, extra: EXTRA });

        const extra = json.proxies.find(p => p.tag === 'extra-node');
        const base = json.proxies.find(p => p.tag === 'base-node');
        expect(extra.extra).toBe(true);
        expect(base.extra).toBe(false);
    });

    it('keeps a YAML source intact when adding a URI node', async () => {
        const app = createApp(runtime());
        const yamlConfig = `proxies:
  - name: yaml-node
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: p`;
        const url = `http://x/clash?config=${encodeURIComponent(yamlConfig)}&extra=${encodeURIComponent(EXTRA)}`;

        const res = await app.request(url);
        const config = yaml.load(await res.text());

        expect(config.proxies.map(p => p.name)).toEqual(['yaml-node', 'extra-node']);
    });

    it('appends extra nodes to sing-box output', async () => {
        const app = createApp(runtime());
        const url = `http://x/singbox?config=${encodeURIComponent(BASE)}&extra=${encodeURIComponent(EXTRA)}`;

        const res = await app.request(url);
        const config = await res.json();

        expect(config.outbounds.map(o => o.tag)).toContain('extra-node');
    });

    it('appends extra nodes to Xray output', async () => {
        const app = createApp(runtime());
        const url = `http://x/xray?config=${encodeURIComponent(BASE)}&extra=${encodeURIComponent(EXTRA)}`;

        const res = await app.request(url);
        const decoded = Buffer.from(await res.text(), 'base64').toString('utf8');

        expect(decoded).toContain('9.9.9.9:1080');
    });

    it('overwrites an existing short code when continuing the current link', async () => {
        const app = createApp(runtime());
        const longUrl = `https://haovo.loc.cc/clash?config=${encodeURIComponent(BASE)}`;
        const shortRes = await app.request(`http://x/shorten-v2?url=${encodeURIComponent(longUrl)}`);
        const code = (await shortRes.text()).trim();

        const updatedUrl = `https://haovo.loc.cc/clash?config=${encodeURIComponent(BASE)}&extra=${encodeURIComponent(EXTRA)}`;
        const writeRes = await app.request('http://x/shorten-v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: updatedUrl, shortCode: code })
        });
        expect(writeRes.status).toBe(200);

        const served = await app.request(`http://x/c/${code}`);
        const config = yaml.load(await served.text());

        expect(config.proxies.map(p => p.name)).toEqual(['base-node', 'extra-node']);
    });
});
