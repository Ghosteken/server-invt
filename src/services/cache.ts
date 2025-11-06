import type { Redis } from "ioredis";

type CacheEntry = { value: any; expiresAt: number };
const memoryCache = new Map<string, CacheEntry>();
let redisClient: Redis | null = null;
let redisInitAttempted = false;

async function ensureRedis(): Promise<Redis | null> {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;
  const url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  if (!url) return null;
  try {
    // Dynamic import to avoid hard dependency when Redis isn't used
    // @ts-ignore
    const mod = await import("ioredis");
    const RedisCtor: any = mod.default || mod;
    redisClient = new RedisCtor(url, { lazyConnect: true });
    try { await (redisClient as any).connect?.(); } catch {}
    return redisClient;
  } catch (e) {
    console.warn("Redis not available; using memory cache.");
    return null;
  }
}

export async function cacheGet<T = any>(key: string): Promise<T | null> {
  const rc = await ensureRedis();
  if (rc) {
    try {
      const raw = await rc.get(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch { return null; }
  }
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
}

export async function cacheSet(key: string, value: any, ttlSeconds: number): Promise<void> {
  const rc = await ensureRedis();
  if (rc) {
    try {
      await rc.set(key, JSON.stringify(value), "EX", Math.max(1, Math.floor(ttlSeconds)));
      return;
    } catch {}
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function withCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached != null) return cached;
  const val = await loader();
  await cacheSet(key, val, ttlSeconds);
  return val;
}