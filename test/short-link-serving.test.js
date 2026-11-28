import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const runtime = () => ({ kv: new MemoryKVAdapter(), assetFetcher: null, logger: console, config: {} });

const YAML = `proxies:
  - name: short-link-node
    type: socks5
    server: disp.example.com
    port: 8001
    username: user
    password: secret`;

async function shorten(app, longUrl) {
    const res = await app.request(`http://x/shorten-v2?url=${encodeURIComponent(longUrl)}`);
    expect(res.status).toBe(200);
    return (await res.text()).trim();
}

describe('short link serving', () => {
    it('returns the config body instead of redirecting', async () => {
        const app = createApp(runtime());
        const longUrl = `https://haovo.loc.cc/clash?config=${encodeURIComponent(YAML)}&selectedRules=minimal`;
        const code = await shorten(app, longUrl);

        const res = await app.request(`http://x/c/${code}`);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/yaml');
        const text = await res.text();
        expect(text).toContain('short-link-node');
    });

    it('never emits a Location header', async () => {
        const app = createApp(runtime());
        const longUrl = `https://haovo.loc.cc/clash?config=${encodeURIComponent(YAML)}`;
        const code = await shorten(app, longUrl);

        const res = await app.request(`http://x/c/${code}`);

        expect(res.headers.get('location')).toBeNull();
    });

    it('serves sing-box JSON from the /b prefix', async () => {
        const app = createApp(runtime());
        const longUrl = `https://haovo.loc.cc/singbox?config=${encodeURIComponent(YAML)}`;
        const code = await shorten(app, longUrl);

        const res = await app.request(`http://x/b/${code}`);

        expect(res.status).toBe(200);
        const config = await res.json();
        expect(config.outbounds.some(item => item.tag === 'short-link-node')).toBe(true);
    });

    it('returns 404 for an unknown code', async () => {
        const app = createApp(runtime());

        const res = await app.request('http://x/c/doesNotExist');

        expect(res.status).toBe(404);
    });

    it('resolve returns the original URL without mutating its config', async () => {
        const app = createApp(runtime());
        const longUrl = `https://haovo.loc.cc/clash?config=${encodeURIComponent(YAML)}&overridesId=ov_AbCd1234`;
        const code = await shorten(app, longUrl);

        const res = await app.request(`http://x/resolve?url=${encodeURIComponent(`https://haovo.loc.cc/c/${code}`)}`);
        const data = await res.json();
        const resolved = new URL(data.originalUrl);

        expect(res.status).toBe(200);
        expect(resolved.pathname).toBe('/clash');
        expect(resolved.searchParams.get('config')).toBe(YAML);
        expect(resolved.searchParams.get('overridesId')).toBe('ov_AbCd1234');
    });
});
