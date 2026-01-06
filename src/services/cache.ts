import { createClient } from "redis";

type RedisClientType = ReturnType<typeof createClient>;
type CacheEntry = { value: any; expiresAt: number };

const memoryCache = new Map<string, CacheEntry>();
let redisClient: RedisClientType | null = null;
let redisInitAttempted = false;

async function ensureRedis(): Promise<RedisClientType | null> {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;
  
  let url = process.env.REDIS_URL;

  // Auto-configure Upstash if REDIS_URL is missing but Upstash creds are present
  if (!url && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const host = process.env.UPSTASH_REDIS_REST_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    // Construct standard Redis TCP (SSL) URL: rediss://default:<token>@<host>:6379
    url = `rediss://default:${token}@${host}:6379`;
    console.log("Configuring Redis using Upstash credentials...");
  }

  if (!url) return null;

  try {
    // Create client
    const client = createClient({ url });
    
    // Handle errors (important so it doesn't crash app)
    client.on("error", (err) => {
      console.warn("Redis Client Error", err);
    });

    await client.connect();
    redisClient = client;
    console.log("Redis Connected Successfully");
    return redisClient;
  } catch (e) {
    console.warn("Redis not available; using memory cache.", e);
    return null;
  }
}

export async function cacheGet<T = any>(key: string): Promise<T | null> {
  const rc = await ensureRedis();
  if (rc && rc.isOpen) {
    try {
      const raw = await rc.get(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch { return null; }
  }

  // Memory Fallback
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
  if (rc && rc.isOpen) {
    try {
      // Redis v4 syntax: SET key value { EX: seconds }
      await rc.set(key, JSON.stringify(value), { EX: Math.max(1, Math.floor(ttlSeconds)) });
      return;
    } catch (e) {
        console.warn("Redis set failed", e);
    }
  }

  // Memory Fallback
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function withCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached != null) return cached;
  
  const val = await loader();
  await cacheSet(key, val, ttlSeconds);
  return val;
}

export async function cacheDelete(key: string): Promise<void> {
  const rc = await ensureRedis();
  if (rc && rc.isOpen) {
    try {
      await rc.del(key);
      return;
    } catch (e) {
      console.warn("Redis delete failed", e);
    }
  }
  memoryCache.delete(key);
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
  const rc = await ensureRedis();
  if (rc && rc.isOpen) {
    try {
      // Use keys for simplicity, though SCAN is better for large DBs
      const keys = await rc.keys(pattern);
      if (keys.length > 0) {
        await rc.del(keys);
      }
      return;
    } catch (e) {
      console.warn("Redis delete pattern failed", e);
    }
  }

  // Memory Fallback
  // Convert glob-like pattern (e.g. "prefix:*") to regex
  // This is a simple implementation assuming * is the only wildcard
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
    }
  }
}
