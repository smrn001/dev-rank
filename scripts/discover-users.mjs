/**
 * Discover EVERY GitHub user whose profile location matches Nepal — with NO
 * follower-count threshold.
 *
 * This replicates committers.top's universe (`location:nepal`) minus its
 * `.sort(_.followers).take(1000)` gate, which silently excludes low-follower
 * accounts (~95% of the population).
 *
 * The GitHub Search API never returns more than 1,000 results per query, so we
 * partition the space into `followers:<lo>..<hi>` buckets small enough to fit,
 * recursing into overflow buckets (and falling back to creation-date splits if
 * a single follower value somehow exceeds the cap). Results are deduplicated
 * by GitHub user id.
 *
 * Output: data/users.json
 */
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { searchUsers, searchCount } from "./lib/github.mjs";

const BASE_QUERY = "location:nepal type:user";
/** Width of the initial follower buckets; overflow buckets are split further. */
const BUCKET_WIDTH = 512;
/** Absolute ceiling on follower counts — loop safety net only. */
const HARD_CEILING = 2_000_000;
/** Stop after this many consecutive empty high buckets. */
const MAX_EMPTY_TAIL_BUCKETS = 3;

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(DATA_DIR, "users.json");

/** Followers clause for an inclusive integer range. */
const fRange = (lo, hi) => `followers:${lo}..${hi}`;

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

/** GitHub launched Oct 2007; used as the start of creation-date fallbacks. */
const GITHUB_EPOCH = new Date("2007-10-01");

/**
 * Resolve one bucket of the search space, harvesting users into `out`.
 * Falls back to creation-date splitting when a single follower value alone
 * exceeds the 1,000-result search cap.
 */
async function resolveBucket(lo, hi, out, stats, depth = 0) {
  const clause = fRange(lo, hi);
  const total = await searchCount(`${BASE_QUERY} ${clause}`);
  if (total === 0) return;
  if (total <= 1000) {
    const items = await searchUsers(`${BASE_QUERY} ${clause}`);
    items.forEach((item) => out.set(item.id, item));
    stats.buckets += 1;
    stats.harvested += items.length;
    console.log(
      `  [${clause}] total=${total} harvested=${items.length} (unique so far: ${out.size})`,
    );
    return;
  }
  if (lo >= hi) {
    // A single follower value saturates the search cap -> split by join date.
    await resolveByDate(lo, hi, GITHUB_EPOCH, new Date(), out, stats);
    return;
  }
  if (depth > 24) {
    console.warn(`  !! giving up on ${clause}: still ${total} results at max depth`);
    stats.abandoned += total;
    return;
  }
  // Overflow: split the follower range and recurse.
  const mid = Math.floor((lo + hi) / 2);
  await resolveBucket(lo, mid, out, stats, depth + 1);
  await resolveBucket(mid + 1, hi, out, stats, depth + 1);
}

/**
 * Split a saturated single-follower-value bucket by account creation date.
 */
async function resolveByDate(lo, hi, from, to, out, stats, depth = 0) {
  const clause = `${fRange(lo, hi)} created:${ymd(from)}..${ymd(to)}`;
  const total = await searchCount(`${BASE_QUERY} ${clause}`);
  if (total === 0) return;
  // A single day can't be split further — accept possible truncation rather
  // than recursing into an invalid range.
  const saturated = from >= to || depth > 16;
  if (total <= 1000 || saturated) {
    const items =
      total <= 1000 ? await searchUsers(`${BASE_QUERY} ${clause}`) : [];
    items.forEach((item) => out.set(item.id, item));
    stats.buckets += 1;
    stats.harvested += items.length;
    console.log(
      `  [${clause}] total=${total} harvested=${items.length}${items.length === total ? "" : " (UNRESOLVED)"}`,
    );
    if (items.length !== total) stats.abandoned += total - items.length;
    return;
  }
  const mid = addDays(from, Math.max(1, Math.round((to - from) / 86_400_000 / 2)));
  await resolveByDate(lo, hi, from, addDays(mid, -1), out, stats, depth + 1);
  await resolveByDate(lo, hi, mid, to, out, stats, depth + 1);
}

async function main() {
  console.log(`counting ${BASE_QUERY} ...`);
  const grandTotal = await searchCount(BASE_QUERY);
  console.log(`GitHub reports ${grandTotal} matching users`);

  const out = new Map(); // id -> search item
  const stats = { buckets: 0, harvested: 0, abandoned: 0 };
  let emptyTail = 0;

  for (let lo = 0; lo <= HARD_CEILING && emptyTail < MAX_EMPTY_TAIL_BUCKETS; ) {
    const hi = lo + BUCKET_WIDTH - 1;
    const clause = fRange(lo, hi);
    const total = await searchCount(`${BASE_QUERY} ${clause}`);
    if (total === 0) {
      emptyTail += 1;
      console.log(`  [${clause}] empty (${emptyTail}/${MAX_EMPTY_TAIL_BUCKETS} towards stop)`);
    } else {
      emptyTail = 0;
      await resolveBucket(lo, hi, out, stats);
      console.log(`  progress: ${out.size} unique users`);
    }
    lo = hi + 1;
  }

  const users = [...out.values()].map((item) => ({
    id: item.id,
    login: item.login,
    avatarUrl: item.avatar_url,
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    query: BASE_QUERY,
    followerThreshold: null,
    totalReportedBySearch: grandTotal,
    uniqueUsers: users.length,
    abandonedResults: stats.abandoned,
    users,
  };

  await mkdir(DATA_DIR, { recursive: true });
  const tmp = OUT_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(payload, null, 2));
  await rename(tmp, OUT_FILE);

  console.log("\n--- discovery summary ---");
  console.log(`reported by search : ${grandTotal}`);
  console.log(`unique users saved : ${users.length}`);
  console.log(`buckets processed  : ${stats.buckets}`);
  if (stats.abandoned > 0) console.warn(`ABANDONED results  : ${stats.abandoned}`);
  if (grandTotal - users.length > grandTotal * 0.02) {
    console.warn(
      `warning: ${grandTotal - users.length} users unaccounted for (>2% drift)`,
    );
  }
  console.log(`written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
