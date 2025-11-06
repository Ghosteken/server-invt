"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cache_1 = require("../services/cache");
describe('cache service', () => {
    beforeEach(() => {
        jest.useRealTimers();
        delete process.env.REDIS_URL;
        delete process.env.UPSTASH_REDIS_REST_URL;
    });
    test('set/get stores values and respects TTL in memory fallback', async () => {
        await (0, cache_1.cacheSet)('k1', { a: 1 }, 1); // TTL 1s
        const v1 = await (0, cache_1.cacheGet)('k1');
        expect(v1).toEqual({ a: 1 });
        // Advance system time to expire
        jest.useFakeTimers();
        const now = Date.now();
        jest.setSystemTime(new Date(now + 2000));
        const v2 = await (0, cache_1.cacheGet)('k1');
        expect(v2).toBeNull();
        jest.useRealTimers();
    });
    test('withCache loads and serializes value and reuses until TTL', async () => {
        let loaderCalls = 0;
        const loader = async () => { loaderCalls++; return { n: 42 }; };
        const first = await (0, cache_1.withCache)('k2', 5, loader);
        expect(first).toEqual({ n: 42 });
        expect(loaderCalls).toBe(1);
        const second = await (0, cache_1.withCache)('k2', 5, loader);
        expect(second).toEqual({ n: 42 });
        expect(loaderCalls).toBe(1);
    });
    test('Redis path gracefully falls back when REDIS_URL is absent', async () => {
        const v = await (0, cache_1.withCache)('k3', 1, async () => 'x');
        expect(v).toBe('x');
        const read = await (0, cache_1.cacheGet)('k3');
        expect(read).toBe('x');
    });
});
