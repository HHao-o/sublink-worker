import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';
import { splitConcatenatedLinks } from '../src/utils.js';

const HY2 = 'hy2://f05cce19-eda9-4149-ad98-46703e859525@45.137.180.23:443/?mport=40000-40015&sni=45.137.180.23&obfs=salamander&obfs-password=MLog68OYCOg4ZNDxywFF09cHOYJdLml7#ja';
const ANYTLS = 'anytls://f05cce19-eda9-4149-ad98-46703e859525@34.104.218.110:2443/?sni=34.85.43.149&fp=chrome#ja-isp';

describe('splitConcatenatedLinks', () => {
    it('splits links joined by a space', () => {
        expect(splitConcatenatedLinks(`${HY2} ${ANYTLS}`)).toEqual([HY2, ANYTLS]);
    });

    it('splits links joined by a comma', () => {
        expect(splitConcatenatedLinks(`${HY2},${ANYTLS}`)).toEqual([HY2, ANYTLS]);
    });

    it('keeps a scheme inside a query value as part of the same link', () => {
        const url = 'https://sub.example.com/all?url=https://inner.example.com/list';
        expect(splitConcatenatedLinks(url)).toEqual([url]);
    });

    it('returns a single link untouched', () => {
        expect(splitConcatenatedLinks(HY2)).toEqual([HY2]);
    });

    it('leaves a vmess link intact instead of splitting at its ss suffix', () => {
        const vmess = 'vmess://eyJhZGQiOiIxLjIuMy40In0=#node';
        expect(splitConcatenatedLinks(vmess)).toEqual([vmess]);
    });
});

describe('multiple nodes in one input', () => {
    async function clashProxies(input) {
        const config = yaml.load(await new ClashConfigBuilder(input, 'minimal', [], null, 'zh-CN').build());
        return config.proxies;
    }

    it('parses two links separated by newlines', async () => {
        const proxies = await clashProxies(`${HY2}\n${ANYTLS}`);

        expect(proxies.map(p => p.name)).toEqual(['ja', 'ja-isp']);
        expect(proxies.map(p => p.type)).toEqual(['hysteria2', 'anytls']);
    });

    it('parses two links separated by a space', async () => {
        const proxies = await clashProxies(`${HY2} ${ANYTLS}`);

        expect(proxies.map(p => p.name)).toEqual(['ja', 'ja-isp']);
    });

    it('parses two links separated by a comma', async () => {
        const proxies = await clashProxies(`${HY2},${ANYTLS}`);

        expect(proxies.map(p => p.name)).toEqual(['ja', 'ja-isp']);
    });
});
