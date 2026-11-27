import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';
import { SingboxConfigBuilder } from '../src/builders/SingboxConfigBuilder.js';
import { isValidRealityPublicKey } from '../src/utils.js';

const VALID_PBK = 'LWfC_chpo4uDtzJ9VVnuTcf6zTzWKx-LCJAE2Ltl7h4';
const SHORT_PBK = 'sli7AT0WEhYMARhHh-ZQMK7zHHn0cGsxw2gPhoBis';

function vlessUri(pbk, tag, sid = '5818adc3') {
    return `vless://40a4b915-5e6f-4316-9bb1-e899f30608e3@172.233.129.172:443?type=tcp&encryption=none&flow=&sni=itunes.apple.com&fp=chrome&security=reality&pbk=${pbk}&sid=${sid}#${tag}`;
}

describe('isValidRealityPublicKey', () => {
    it('accepts a 43-char base64url key', () => {
        expect(isValidRealityPublicKey(VALID_PBK)).toBe(true);
    });

    it('rejects a key that does not decode to 32 bytes', () => {
        expect(isValidRealityPublicKey(SHORT_PBK)).toBe(false);
    });

    it('rejects empty and non-string values', () => {
        expect(isValidRealityPublicKey('')).toBe(false);
        expect(isValidRealityPublicKey(undefined)).toBe(false);
        expect(isValidRealityPublicKey(null)).toBe(false);
    });
});

describe('malformed REALITY keys are dropped', () => {
    it('keeps the good node and drops the bad one in Clash output', async () => {
        const input = `${vlessUri(VALID_PBK, 'good')}\n${vlessUri(SHORT_PBK, 'bad')}`;
        const config = yaml.load(await new ClashConfigBuilder(input, 'minimal', [], null, 'zh-CN').build());

        expect(config.proxies.map(p => p.name)).toEqual(['good']);
    });

    it('keeps the good node and drops the bad one in sing-box output', async () => {
        const input = `${vlessUri(VALID_PBK, 'good')}\n${vlessUri(SHORT_PBK, 'bad')}`;
        const config = await new SingboxConfigBuilder(input, 'minimal', [], null, 'zh-CN').build();

        const tags = config.outbounds.map(o => o.tag);
        expect(tags).toContain('good');
        expect(tags).not.toContain('bad');
    });

    it('keeps every node when all keys are valid', async () => {
        const input = `${vlessUri(VALID_PBK, 'a', 'aaaaaaaa')}\n${vlessUri(VALID_PBK, 'b', 'bbbbbbbb')}`;
        const config = yaml.load(await new ClashConfigBuilder(input, 'minimal', [], null, 'zh-CN').build());

        expect(config.proxies.map(p => p.name)).toEqual(['a', 'b']);
    });
});
