/**
 * Minimal dependency-free GitHub REST + GraphQL client used by the
 * dev-rank collection scripts.
 *
 * Design notes:
 * - Search API allows 30 requests/min -> paced at ~2.2s between calls.
 * - Secondary rate limits (HTTP 403/429) are retried with exponential backoff,
 *   honouring `retry-after` when present.
 * - GraphQL batching keeps point cost negligible (measured ~1 point per batch),
 *   so the practical limit is request pacing, not quota.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function loadToken() {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  // Fall back to reading .env.local from the repo root so the scripts can be
  // run directly (`node scripts/...`) without exporting anything manually.
  try {
    const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const match = /^GITHUB_TOKEN=(.+)$/m.exec(env);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* no .env.local */
  }
  return undefined;
}

const TOKEN = loadToken();

if (!TOKEN) {
  console.error(
    "error: GITHUB_TOKEN is required (set it in the environment or .env.local)",
  );
  process.exit(1);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimum gap between successive GitHub Search API calls (30/min limit). */
const SEARCH_INTERVAL_MS = 2200;
/** Minimum gap between successive GraphQL calls (secondary-limit safety). */
const GRAPHQL_INTERVAL_MS = 700;

let lastSearchAt = 0;
let lastGraphqlAt = 0;

async function pace(kind) {
  const now = Date.now();
  const last = kind === "search" ? lastSearchAt : lastGraphqlAt;
  const interval = kind === "search" ? SEARCH_INTERVAL_MS : GRAPHQL_INTERVAL_MS;
  const wait = last + interval - now;
  if (wait > 0) await sleep(wait);
  if (kind === "search") lastSearchAt = Date.now();
  else lastGraphqlAt = Date.now();
}

/**
 * fetch with retry + backoff. Retries on HTTP 403/429/5xx (rate limiting or
 * transient failures) and on network errors.
 */
async function fetchWithRetry(url, init, { label, retries = 6 } = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= retries) throw err;
      const backoff = Math.min(60_000, 2 ** attempt * 1000);
      console.warn(`  network error on ${label}, retry ${attempt} in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }

    if (res.ok) return res;

    const retryAfter = Number(res.headers.get("retry-after"));
    const retryable =
      res.status === 403 || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      const body = await res.text();
      throw new Error(
        `${label} failed: HTTP ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    const backoff =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(90_000, 2 ** attempt * 1000);
    console.warn(
      `  HTTP ${res.status} on ${label}; backing off ${Math.round(backoff / 1000)}s (attempt ${attempt}/${retries})`,
    );
    await sleep(backoff);
  }
}

function searchInit() {
  return {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dev-rank-collector",
    },
  };
}

/**
 * Search users. Returns array of raw item objects ({ id, login, avatar_url }).
 * Paginates internally; never harvests beyond GitHub's hard 1000-result cap
 * per query (callers must keep individual queries below the cap).
 */
export async function searchUsers(query, { maxPages = 10, perPage = 100 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    await pace("search");
    const url =
      "https://api.github.com/search/users?q=" +
      encodeURIComponent(query) +
      `&per_page=${perPage}&page=${page}`;
    const res = await fetchWithRetry(url, searchInit(), {
      label: `search "${query}" page ${page}`,
    });
    const json = await res.json();
    items.push(...json.items);
    const harvested = page * perPage;
    if (
      json.items.length < perPage ||
      harvested >= json.total_count ||
      harvested >= 1000
    ) {
      break;
    }
  }
  return items;
}

/** Just the total_count for a query (cheap: per_page=1). */
export async function searchCount(query) {
  await pace("search");
  const url =
    "https://api.github.com/search/users?q=" +
    encodeURIComponent(query) +
    "&per_page=1";
  const res = await fetchWithRetry(url, searchInit(), {
    label: `count "${query}"`,
  });
  const json = await res.json();
  return json.total_count ?? 0;
}

/**
 * Run one GraphQL document. Returns the `data` object. Retries on rate-limit
 * errors; throws GraphQLError (with `.errors`) on non-retryable GraphQL
 * errors (e.g. bad query).
 */
export async function graphql(query, variables = {}, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    await pace("graphql");
    const res = await fetchWithRetry(
      "https://api.github.com/graphql",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "dev-rank-collector",
        },
        body: JSON.stringify({ query, variables }),
      },
      { label: "graphql", retries: 8 },
    );
    const json = await res.json();
    if (!json.errors?.length) return json.data;

    const rateLimited = json.errors.some(
      (e) => e.type?.includes("RATE_LIMIT") || /rate limit/i.test(e.message ?? ""),
    );
    if (rateLimited && attempt < retries) {
      const wait = 60_000 * (attempt + 1);
      console.warn(`  graphql rate limited; waiting ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }
    throw new GraphQLError(json.errors);
  }
}

export class GraphQLError extends Error {
  constructor(errors) {
    super(`graphql errors: ${JSON.stringify(errors).slice(0, 500)}`);
    this.name = "GraphQLError";
    this.errors = errors;
  }
}
