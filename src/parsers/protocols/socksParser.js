import { decodeBase64, parseServerInfo, parseUrlParams } from '../../utils.js';

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const DEFAULT_PORT = 1080;

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

// v2rayN and most clients Base64-encode "user:pass", while hand-written links
// keep the credentials readable. Both forms must keep their own delimiter.
function splitCredentials(raw) {
    if (!raw) {
        return {};
    }
    const readable = safeDecodeURIComponent(raw);
    if (BASE64_PATTERN.test(readable)) {
        const decoded = decodeBase64(readable);
        const separatorIndex = decoded.indexOf(':');
        if (separatorIndex !== -1) {
            return {
                username: decoded.slice(0, separatorIndex),
                password: decoded.slice(separatorIndex + 1)
            };
        }
    }
    const separatorIndex = readable.indexOf(':');
    if (separatorIndex !== -1) {
        return {
            username: readable.slice(0, separatorIndex),
            password: readable.slice(separatorIndex + 1)
        };
    }
    return { username: readable };
}

export function parseSocks(url) {
    // parseUrlParams only reads the fragment after a query string, and SOCKS
    // links are usually written without one.
    const hashIndex = url.indexOf('#');
    const rawName = hashIndex === -1 ? '' : safeDecodeURIComponent(url.slice(hashIndex + 1));
    const { addressPart, params } = parseUrlParams(hashIndex === -1 ? url : url.slice(0, hashIndex));
    const separatorIndex = addressPart.lastIndexOf('@');
    const credentialPart = separatorIndex === -1 ? '' : addressPart.slice(0, separatorIndex);
    const serverInfo = separatorIndex === -1 ? addressPart : addressPart.slice(separatorIndex + 1);

    const parsedServer = serverInfo.includes(':')
        ? parseServerInfo(serverInfo)
        : { host: serverInfo, port: DEFAULT_PORT };
    const host = parsedServer.host;
    const port = Number.isInteger(parsedServer.port) && parsedServer.port > 0
        ? parsedServer.port
        : DEFAULT_PORT;

    const credentials = splitCredentials(credentialPart);
    const username = params.username ?? credentials.username;
    const password = params.password ?? credentials.password;
    if (!host) {
        return undefined;
    }
    const displayHost = host.includes(':') ? `[${host}]` : host;

    return {
        tag: rawName || `SOCKS ${displayHost}:${port}`,
        type: 'socks',
        server: host,
        server_port: port,
        version: '5',
        ...(username ? { username } : {}),
        ...(password ? { password } : {})
    };
}
