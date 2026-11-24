import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const FRONT = `proxies:
  - name: 机场-HK
    type: ss
    server: front.example.com
    port: 443
    cipher: aes-128-gcm
    password: frontpass`;

const BACK = `proxies:
  - name: Oxylabs-US
    type: socks5
    server: disp.example.com
    port: 8001
    username: user
    password: secret`;

async function buildClash(back, front) {
    const builder = new ClashConfigBuilder(
        back,
        'minimal',
        [],
        null,
        'zh-CN',
        undefined,
        false,
        false,
        undefined,
        undefined,
        true,
        front
    );
    return yaml.load(await builder.build());
}

describe('Clash chain proxy', () => {
    it('routes back proxies through a front group', async () => {
        const config = await buildClash(BACK, FRONT);

        const back = config.proxies.find(proxy => proxy.name === 'Oxylabs-US');
        expect(back['dialer-proxy']).toBe('🔗 链式前置');

        const frontGroup = config['proxy-groups'].find(group => group.name === '🔗 链式前置');
        expect(frontGroup).toEqual({ type: 'select', name: '🔗 链式前置', proxies: ['机场-HK'] });
    });

    it('hides front nodes from every exit selector', async () => {
        const config = await buildClash(BACK, FRONT);

        const nodeSelect = config['proxy-groups'].find(group => group.name === '🚀 节点选择');
        expect(nodeSelect.proxies).toContain('Oxylabs-US');
        expect(nodeSelect.proxies).not.toContain('机场-HK');

        const autoSelect = config['proxy-groups'].find(group => group.name === '⚡ 自动选择');
        expect(autoSelect.proxies).not.toContain('机场-HK');
    });

    it('leaves the front node itself without dialer-proxy', async () => {
        const config = await buildClash(BACK, FRONT);

        const front = config.proxies.find(proxy => proxy.name === '机场-HK');
        expect(front).toBeDefined();
        expect(front['dialer-proxy']).toBeUndefined();
    });

    it('keeps the plain output when no chain input is given', async () => {
        const config = await buildClash(BACK, null);

        const back = config.proxies.find(proxy => proxy.name === 'Oxylabs-US');
        expect(back['dialer-proxy']).toBeUndefined();
        expect(config['proxy-groups'].some(group => group.name === '🔗 链式前置')).toBe(false);
    });

    it('wires chain mode through the /clash route', async () => {
        const app = createApp({ kv: new MemoryKVAdapter(), assetFetcher: null, logger: console, config: {} });
        const url = `http://x/clash?config=${encodeURIComponent(BACK)}&chain=${encodeURIComponent(FRONT)}`;
        const res = await app.request(url);

        expect(res.status).toBe(200);
        const config = yaml.load(await res.text());
        expect(config.proxies.find(proxy => proxy.name === 'Oxylabs-US')['dialer-proxy']).toBe('🔗 链式前置');
        expect(config['proxy-groups'].some(group => group.name === '🔗 链式前置')).toBe(true);
    });
});
