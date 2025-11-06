"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.withCache = withCache;
const memoryCache = new Map();
let redisClient = null;
let redisInitAttempted = false;
async function ensureRedis() {
    if (redisInitAttempted)
        return redisClient;
    redisInitAttempted = true;
    const url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || "";
    if (!url)
        return null;
    try {
        // Dynamic import to avoid hard dependency when Redis isn't used
        // @ts-ignore
        const mod = await import("ioredis");
        const RedisCtor = mod.default || mod;
        redisClient = new RedisCtor(url, { lazyConnect: true });
        try {
            await redisClient.connect?.();
        }
        catch { }
        return redisClient;
    }
    catch (e) {
        console.warn("Redis not available; using memory cache.");
        return null;
    }
}
async function cacheGet(key) {
    const rc = await ensureRedis();
    if (rc) {
        try {
            const raw = await rc.get(key);
            return raw ? JSON.parse(raw) : null;
        }
        catch {
            return null;
        }
    }
    const entry = memoryCache.get(key);
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        memoryCache.delete(key);
        return null;
    }
    return entry.value;
}
async function cacheSet(key, value, ttlSeconds) {
    const rc = await ensureRedis();
    if (rc) {
        try {
            await rc.set(key, JSON.stringify(value), "EX", Math.max(1, Math.floor(ttlSeconds)));
            return;
        }
        catch { }
    }
    memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
async function withCache(key, ttlSeconds, loader) {
    const cached = await cacheGet(key);
    if (cached != null)
        return cached;
    const val = await loader();
    await cacheSet(key, val, ttlSeconds);
    return val;
}
