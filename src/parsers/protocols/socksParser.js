import { parseBool } from '../../utils.js';

const SOCKS_SCHEMES = new Set(['socks', 'socks5', 'socks4', 'socks5+tls']);

function decodeComponent(value, formEncoded = false) {
    const input = formEncoded ? value.replace(/\+/g, ' ') : value;
    try {
        return decodeURIComponent(input);
    } catch {
        return value;
    }
}

function decodeToken(value) {
    const token = decodeComponent(value);
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(token)) return null;
    const unpadded = token.replace(/=+$/, '');
    if (unpadded.length % 4 === 1) return null;
    const normalized = unpadded.replace(/-/g, '+').replace(/_/g, '/');
    try {
        const bytes = Uint8Array.from(atob(normalized), char => char.charCodeAt(0));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return /[\x00-\x1f\x7f]/.test(text) ? null : text;
    } catch {
        return null;
    }
}

function credentialsFrom(value, encoded = true) {
    const colon = value.indexOf(':');
    if (colon === -1 && encoded) {
        const decoded = decodeToken(value);
        if (decoded?.includes(':')) return credentialsFrom(decoded, false);
    }
    const username = colon === -1 ? value : value.slice(0, colon);
    const password = colon === -1 ? undefined : value.slice(colon + 1);
    // Decode each field after splitting so an encoded colon in the username
    // cannot become the username/password delimiter.
    return {
        username: encoded ? decodeComponent(username) : username,
        password: password === undefined ? undefined : encoded ? decodeComponent(password) : password
    };
}

function parseEndpoint(value, defaultPort) {
    const match = value.startsWith('[')
        ? /^\[([^\]]+)\](?::([^/]*))?(?:\/.*)?$/.exec(value)
        : /^([^:/?#\s]+)(?::([^/]*))?(?:\/.*)?$/.exec(value);
    if (!match) throw new Error('Invalid SOCKS server address');
    const [, host, rawPort] = match;
    const port = rawPort === undefined ? defaultPort : /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SOCKS port');
    const displayHost = value.startsWith('[') ? `[${host}]` : host;
    try {
        new URL(`http://${displayHost}:${port}`);
    } catch {
        throw new Error('Invalid SOCKS server address');
    }
    return { server: host, server_port: port };
}

function getParam(params, keys) {
    for (const key of keys) {
        if (params.has(key)) return params.get(key);
    }
    return undefined;
}

function parseFlag(value) {
    const flag = value?.trim().toLowerCase();
    if (flag === 'yes' || flag === 'on') return true;
    if (flag === 'no' || flag === 'off') return false;
    return parseBool(flag);
}

export function isBareSocks(input) {
    return /^(?:[^@\s]+@)?(?:\[[a-f\d:.]+\]|[^:/@\s]+):\d+(?::[^{}\r\n]*)?(?:\{[^{}\r\n]*\})?$/i.test(input.trim());
}

export function parseSocks(input) {
    let text = input.trim();
    const suffix = /\{([^{}]*)\}$/.exec(text);
    if (suffix) text = text.slice(0, suffix.index);
    // A trailing refresh URL is metadata, not part of the proxy endpoint.
    text = text.replace(/\[https?:\/\/[^\]]*\]$/, '');

    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
    const protocol = scheme ? scheme[1].toLowerCase() : 'socks';
    if (!SOCKS_SCHEMES.has(protocol)) throw new Error('Unsupported SOCKS scheme');
    if (scheme) text = text.slice(scheme[0].length);

    const hashIndex = text.indexOf('#');
    const fragment = hashIndex === -1 ? '' : decodeComponent(text.slice(hashIndex + 1));
    if (hashIndex !== -1) text = text.slice(0, hashIndex);
    const queryIndex = text.indexOf('?');
    const params = new URLSearchParams(queryIndex === -1 ? '' : text.slice(queryIndex + 1));
    if (queryIndex !== -1) text = text.slice(0, queryIndex);

    const tlsEnabled = protocol === 'socks5+tls' || parseFlag(params.get('tls')) === true;
    const defaultPort = tlsEnabled ? 443 : 1080;
    let decodedAuthority = false;
    if (!text.includes('@') && !text.includes(':')) {
        const decoded = decodeToken(text) ?? decodeToken(text.replace(/\/$/, ''));
        if (decoded?.includes(':')) {
            text = decoded;
            decodedAuthority = true;
        }
    }

    let endpoint = text;
    let credentials = {};
    const atIndex = text.lastIndexOf('@');
    if (atIndex !== -1) {
        endpoint = text.slice(atIndex + 1);
        credentials = credentialsFrom(text.slice(0, atIndex), !decodedAuthority);
    } else if (!text.startsWith('[')) {
        const colonAuth = /^([^:]+):(\d+):([^:]*):(.*)$/.exec(text);
        if (colonAuth) {
            endpoint = `${colonAuth[1]}:${colonAuth[2]}`;
            credentials = credentialsFrom(`${colonAuth[3]}:${colonAuth[4]}`);
        }
    }
    // Bare text is accepted only when it contains an explicit endpoint port.
    if (!scheme && !/^(?:\[[^\]]+\]|[^:/\s]+):\d+(?:\/.*)?$/.test(endpoint)) {
        throw new Error('Invalid SOCKS endpoint');
    }
    const server = parseEndpoint(endpoint, defaultPort);
    const version = protocol === 'socks4' ? '4' : '5';
    const name = suffix ? decodeComponent(suffix[1], true) : fragment || getParam(params, ['remark', 'remarks']);
    const username = params.get('username') ?? credentials.username;
    const password = params.get('password') ?? credentials.password;
    const udp = parseFlag(getParam(params, ['udp', 'udp-relay', 'udp_relay']));
    const displayHost = server.server.includes(':') ? `[${server.server}]` : server.server;
    const proxy = {
        tag: name || `SOCKS ${displayHost}:${server.server_port}`,
        type: 'socks',
        ...server,
        version,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
        ...(udp !== undefined ? { udp } : {})
    };
    if (tlsEnabled) {
        if (version !== '5') throw new Error('SOCKS4 over TLS is not supported');
        const serverName = getParam(params, ['sni', 'peer', 'tls-name', 'tls_name']);
        const insecure = parseFlag(getParam(params, ['skip-cert-verify', 'skip_cert_verify', 'allowInsecure', 'allow_insecure', 'allow-insecure', 'insecure']));
        const verification = parseFlag(params.get('tls-verification'));
        proxy.tls = {
            enabled: true,
            ...(serverName?.trim() ? { server_name: serverName.trim() } : {}),
            ...(verification !== undefined ? { insecure: !verification } : insecure !== undefined ? { insecure } : {})
        };
    }
    return proxy;
}
