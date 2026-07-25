// Prisma's `mode: "insensitive"` string-filter option is Postgres/MongoDB
// only — the SQLite connector used by DEMO_MODE rejects it at runtime with
// "Unknown argument `mode`". Spread this in wherever the codebase filters
// on `mode: "insensitive"` so the same call sites work against both
// providers: `{ contains: search, ...CI_MODE }`. SQLite's LIKE is already
// case-insensitive for ASCII text, so omitting `mode` there preserves the
// intended case-insensitive search behavior for the demo dataset.
export const CI_MODE: { mode: "insensitive" } | Record<string, never> =
  process.env.DEMO_MODE === "true" ? {} : { mode: "insensitive" };
