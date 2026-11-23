import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';
import { SingboxConfigBuilder } from '../src/builders/SingboxConfigBuilder.js';
import { ProxyParser } from '../src/parsers/ProxyParser.js';
import { parseSocks } from '../src/parsers/protocols/socksParser.js';
import { encodeBase64 } from '../src/utils.js';

const AUTH = encodeBase64('user:pa:ss');

describe('SOCKS share links', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([
        encodeBase64('alice:pass@node.example.com:8001'),
        encodeBase64('alice:pass@node.example.com:8001').replace(/=/g, '')
    ])('decodes a whole Base64 authority: %s', token => {
        expect(parseSocks(`socks://${token}#whole`)).toMatchObject({
            tag: 'whole', server: 'node.example.com', server_port: 8001,
            username: 'alice', password: 'pass'
        });
    });

    it('supports URL-safe Base64 and Unicode credentials', () => {
        const token = encodeBase64('用戶:密碼😀').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        expect(parseSocks(`socks://${token}@node.example.com:1080/`)).toMatchObject({
            server: 'node.example.com', username: '用戶', password: '密碼😀'
        });
    });

    it('splits credentials before URI decoding and preserves literal plus signs', () => {
        expect(parseSocks('socks://alice%3Ateam:p%40ss%3Aword%25+@node.example.com:1080/#US+Node')).toMatchObject({
            username: 'alice:team', password: 'p@ss:word%+', tag: 'US+Node'
        });
        const token = encodeBase64('alice:literal%3A+');
        expect(parseSocks(`socks://${token}@node.example.com:1080`).password).toBe('literal%3A+');
    });

    it.each([
        'socks://node.example.com:8001:alice:pa:ss#colon',
        'node.example.com:8001:alice:pa:ss{colon}',
        'alice:pa:ss@node.example.com:8001{colon}'
    ])('supports alternate endpoint notation: %s', input => {
        expect(parseSocks(input)).toMatchObject({
            tag: 'colon', server: 'node.example.com', server_port: 8001,
            username: 'alice', password: 'pa:ss'
        });
    });

    it('reads suffix and query names without treating refresh URLs as endpoints', () => {
        expect(parseSocks('socks://node.example.com:1080[https://refresh.example/sub]{My+Proxy}').tag).toBe('My Proxy');
        expect(parseSocks('socks://node.example.com:1080?remarks=My+Proxy').tag).toBe('My Proxy');
        expect(parseSocks('socks://node.example.com:1080?remarks=other#fragment{suffix}').tag).toBe('suffix');
    });

    it.each(['0', '65536', '-1', 'invalid', '8001x', ''])('rejects an explicitly invalid port: %s', port => {
        expect(() => parseSocks(`socks://node.example.com:${port}`)).toThrow();
    });

    it('rejects missing hosts, malformed IPv6 and unsupported schemes', () => {
        for (const input of ['socks://:1080', 'socks://[::1:1080', 'http://node.example.com:1080']) {
            expect(() => parseSocks(input)).toThrow();
        }
    });

    it.each(['udp', 'udp-relay', 'udp_relay'])('preserves explicit false for %s', key => {
        const proxy = parseSocks(`socks://node.example.com:1080?${key}=off`);
        expect(proxy.udp).toBe(false);
        expect(ClashConfigBuilder.prototype.convertProxy(proxy).udp).toBe(false);
    });

    it('enables TLS only for explicit TLS SOCKS links and preserves verification options', () => {
        const proxy = parseSocks('socks5+tls://alice:pass@node.example.com/?peer=node.example.com&insecure=1&tls-verification=1');
        expect(proxy.server_port).toBe(443);
        expect(ClashConfigBuilder.prototype.convertProxy(proxy)).toMatchObject({
            type: 'socks5', tls: true, 'skip-cert-verify': false
        });
        expect(parseSocks('socks://node.example.com?sni=not-tls.example.com&insecure=1').tls).toBeUndefined();
        expect(parseSocks('socks://node.example.com?tls=true').tls.enabled).toBe(true);
    });

    it('does not lose a Base64 password containing an at sign', () => {
        expect(parseSocks(`socks://${encodeBase64('user:p@ss')}@node.example.com:1080`)).toMatchObject({
            username: 'user', password: 'p@ss'
        });
    });

    it('restricts explicitly disabled SOCKS UDP to TCP in sing-box', () => {
        expect(SingboxConfigBuilder.prototype.convertProxy(parseSocks('socks://node.example.com?udp=false')).network).toBe('tcp');
    });

    it('does not silently discard independent SOCKS TLS SNI in Mihomo', () => {
        const proxy = parseSocks('socks5+tls://192.0.2.1:443?sni=tls.example.com');
        expect(ClashConfigBuilder.prototype.convertProxy(proxy)).toBeNull();
    });

    it('does not emit unsupported SOCKS4 in Clash or TLS SOCKS in sing-box', () => {
        const socks4 = parseSocks('socks4://alice@node.example.com:1080');
        expect(socks4.version).toBe('4');
        expect(ClashConfigBuilder.prototype.convertProxy(socks4)).toBeNull();
        expect(SingboxConfigBuilder.prototype.convertProxy(parseSocks('socks5+tls://node.example.com'))).toBeNull();
    });

    it('imports bare SOCKS endpoints through the generic parser without changing other schemes', async () => {
        expect((await ProxyParser.parse('node.example.com:8001:alice:pass{bare}'))?.tag).toBe('bare');
        expect(await ProxyParser.parse('not a proxy')).toBeUndefined();
        expect(await ProxyParser.parse('unknown://node.example.com:8001')).toBeUndefined();
    });

    it('decodes remote Base64 SOCKS-only subscriptions', async () => {
        const lines = `socks://${AUTH}@node.example.com:8001#us\nsocks://${AUTH}@node.example.com:8002#jp`;
        vi.stubGlobal('fetch', vi.fn(async () => new Response(encodeBase64(lines))));
        const config = yaml.load(await new ClashConfigBuilder('https://subscription.example/socks', 'minimal', [], null, 'zh-CN').build());
        expect(config.proxies.map(proxy => proxy.name)).toEqual(['us', 'jp']);
    });

    it.each([false, true])('preserves escaped credentials in remote SOCKS subscriptions (Base64: %s)', async base64 => {
        const input = 'socks://alice%3Ateam:p%40ss%25%2B@node.example.com:1080/#safe';
        vi.stubGlobal('fetch', vi.fn(async () => new Response(base64 ? encodeBase64(input) : input)));
        const config = yaml.load(await new ClashConfigBuilder('https://subscription.example/socks', 'minimal', [], null, 'zh-CN').build());
        expect(config.proxies[0]).toMatchObject({ username: 'alice:team', password: 'p@ss%+' });
    });

    it('keeps non-SOCKS decoding unchanged in mixed remote subscriptions', async () => {
        const input = [
            'socks://alice%3Ateam:p%40ss%25%2B@node.example.com:1080/#safe',
            'anytls://password@node.example.com:443?sni=tls.example.com#Any%20TLS'
        ].join('\n');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(input)));
        const config = yaml.load(await new ClashConfigBuilder('https://subscription.example/mixed', 'minimal', [], null, 'zh-CN').build());
        expect(config.proxies[0]).toMatchObject({ username: 'alice:team', password: 'p@ss%+' });
        expect(config.proxies[1]).toMatchObject({ name: 'Any TLS', type: 'anytls', sni: 'tls.example.com' });
    });

    it('retains two credential-distinct nodes at the same SOCKS gateway', async () => {
        const input = [
            `socks://${encodeBase64('customer-us:pass')}@node.example.com:8001#us`,
            `socks://${encodeBase64('customer-jp:pass')}@node.example.com:8001#jp`
        ].join('\n');
        const config = yaml.load(await new ClashConfigBuilder(input, 'minimal', [], null, 'zh-CN').build());
        expect(config.proxies.map(({ name, username, server, port }) => ({ name, username, server, port }))).toEqual([
            { name: 'us', username: 'customer-us', server: 'node.example.com', port: 8001 },
            { name: 'jp', username: 'customer-jp', server: 'node.example.com', port: 8001 }
        ]);
    });

    it('keeps valid nodes when one SOCKS endpoint is malformed', async () => {
        const input = 'socks://node.example.com:0#invalid\nsocks://node.example.com:1080#valid';
        const config = yaml.load(await new ClashConfigBuilder(input, 'minimal', [], null, 'zh-CN').build());
        expect(config.proxies.map(proxy => proxy.name)).toEqual(['valid']);
    });

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

describe('SOCKS proxies in Clash YAML', () => {
    const yamlInput = `proxies:
  - name: Oxylabs-US-ISP-1
    type: socks5
    server: disp.example.com
    port: 8001
    username: user-disp_c3cf0111
    password: secret
    udp: true`;

    it('parses a socks5 entry into a Clash socks5 proxy', async () => {
        const config = yaml.load(await new ClashConfigBuilder(yamlInput, 'minimal', [], null, 'zh-CN').build());

        expect(config.proxies).toEqual([
            {
                name: 'Oxylabs-US-ISP-1',
                type: 'socks5',
                server: 'disp.example.com',
                port: 8001,
                username: 'user-disp_c3cf0111',
                password: 'secret',
                udp: true
            }
        ]);
    });

    it('parses a socks5 entry into a sing-box socks outbound', async () => {
        const config = await new SingboxConfigBuilder(yamlInput, 'minimal', [], null, 'zh-CN').build();
        const outbound = config.outbounds.find(item => item.type === 'socks');

        expect(outbound).toEqual({
            tag: 'Oxylabs-US-ISP-1',
            type: 'socks',
            server: 'disp.example.com',
            server_port: 8001,
            version: '5',
            username: 'user-disp_c3cf0111',
            password: 'secret'
        });
    });
});
