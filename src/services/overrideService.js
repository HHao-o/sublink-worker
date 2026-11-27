import { generateWebPath } from '../utils.js';
import { InvalidPayloadError, MissingDependencyError } from './errors.js';

// Node overrides are replacements keyed by node name, applied after a
// subscription is parsed. They live in KV because the same table has to be
// reachable from a short link, which only carries the id.
export class OverrideService {
    constructor(kv, options = {}) {
        this.kv = kv;
        this.options = options;
    }

    ensureKv() {
        if (!this.kv) {
            throw new MissingDependencyError('Override storage requires a KV store');
        }
        return this.kv;
    }

    async save(overrides) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
            throw new InvalidPayloadError('Overrides must be a plain object');
        }
        const entries = Object.entries(overrides)
            .filter(([tag, uri]) => typeof tag === 'string' && tag.trim() !== '' && typeof uri === 'string' && uri.trim() !== '');
        if (entries.length === 0) {
            throw new InvalidPayloadError('Overrides must contain at least one node');
        }

        const kv = this.ensureKv();
        const id = `ov_${generateWebPath(8)}`;
        // No expiry: a short link pointing at this id must keep working.
        await kv.put(id, JSON.stringify(Object.fromEntries(entries)));
        return id;
    }

    async get(id) {
        if (typeof id !== 'string' || !id.startsWith('ov_')) {
            return null;
        }
        const kv = this.ensureKv();
        const raw = await kv.get(id);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
}
