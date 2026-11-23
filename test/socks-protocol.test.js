import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';
import { SingboxConfigBuilder } from '../src/builders/SingboxConfigBuilder.js';
import { ProxyParser } from '../src/parsers/ProxyParser.js';
import { parseSocks } from '../src/parsers/protocols/socksParser.js';
import { encodeBase64 } from '../src/utils.js';

const AUTH = encodeBase64('user:pa:ss');

describe('SOCKS share links', () => {
    it('parses the Base64 credentials emitted by v2rayN', () => {
        expect(parseSocks(`socks://${AUTH}@node.example.com:8001#us`)).toEqual({
            tag: 'us',
            type: 'socks',
            server: 'node.example.com',
            server_port: 8001,
            version: '5',
            username: 'user',
            password: 'pa:ss'
        });
    });

    it('parses plain credentials and links without authentication', () => {
        expect(parseSocks('socks://alice:s3cret@node.example.com:1080#plain')).toMatchObject({
            username: 'alice',
            password: 's3cret'
        });
        expect(parseSocks('socks://node.example.com:1080#anon')).toEqual({
            tag: 'anon',
            type: 'socks',
            server: 'node.example.com',
            server_port: 1080,
            version: '5'
        });
    });

    it('keeps IPv6 authorities and applies the default port', () => {
        const ipv6 = parseSocks(`socks5://${AUTH}@[2001:db8::1]:1080#v6`);
        expect(ipv6.server).toBe('2001:db8::1');
        expect(ipv6.tag).toBe('v6');

        const noPort = parseSocks('socks://node.example.com#fallback');
        expect(noPort.server_port).toBe(1080);
        expect(noPort.tag).toBe('fallback');
    });

    it('lets query parameters override credentials', () => {
        const proxy = parseSocks(`socks://${AUTH}@node.example.com:1080?username=override&password=querypass#query`);
        expect(proxy.username).toBe('override');
        expect(proxy.password).toBe('querypass');
    });

    it('registers socks:// and socks5:// in the generic proxy parser', async () => {
        expect((await ProxyParser.parse(`SOCKS://${AUTH}@node.example.com:1080`)).type).toBe('socks');
        expect((await ProxyParser.parse(`socks5://${AUTH}@node.example.com:1080`)).type).toBe('socks');
    });

    it('emits every SOCKS link from a multi-line input as Clash proxies', async () => {
        const input = [
            `socks://${AUTH}@node.example.com:8001#us`,
            `socks://${AUTH}@node.example.com:8002#jp`
        ].join('\n');
        const config = yaml.load(await new ClashConfigBuilder(input, 'minimal', [], null, 'zh-CN').build());

        expect(config.proxies).toEqual([
            {
                name: 'us',
                type: 'socks5',
                server: 'node.example.com',
                port: 8001,
                username: 'user',
                password: 'pa:ss',
                udp: true
            },
            {
                name: 'jp',
                type: 'socks5',
                server: 'node.example.com',
                port: 8002,
                username: 'user',
                password: 'pa:ss',
                udp: true
            }
        ]);
        expect(config['proxy-groups'][0].proxies).toEqual([
            '⚡ 自动选择',
            'us',
            'jp',
            'DIRECT',
            'REJECT'
        ]);
    });

    it('emits a native sing-box socks outbound without Clash-only fields', async () => {
        const builder = new SingboxConfigBuilder(`socks://${AUTH}@node.example.com:1080#socks`, 'minimal', [], null, 'zh-CN');
        const config = await builder.build();
        const outbound = config.outbounds.find(item => item.type === 'socks');

        expect(outbound).toEqual({
            tag: 'socks',
            type: 'socks',
            server: 'node.example.com',
            server_port: 1080,
            version: '5',
            username: 'user',
            password: 'pa:ss'
        });
    });
});
