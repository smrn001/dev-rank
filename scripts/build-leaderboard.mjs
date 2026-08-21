/**
 * Merge discovery + contribution data and produce the ranked leaderboard.
 *
 * Ranking replicates committers.top's `_private` list, minus the follower
 * gate. Where committers.top does:
 *
 *   githubUsers.sort(_.followers)
 *              .filter(_.location == 'Nepal')
 *              .take(1000)          // <-- follower limit (removed here)
 *              .sort(_.contributions)
 *              .take(256)
 *
 * we rank EVERY discovered user by total contributions (commits, PRs, issues,
 * PR reviews and private contributions over the past year).
 *
 * Input : data/users.json, data/contributions.json
 * Output: data/leaderboard.json (full), data/rank_only.json (compact)
 */
import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

/** PRD §12 activity weights — informational alternative metric, not the main sort. */
export const ACTIVITY_WEIGHTS = {
  commits: 1,
  pullRequests: 3,
  reviews: 2,
  issues: 1,
};

function activityScore(m) {
  return (
    m.commits * ACTIVITY_WEIGHTS.commits +
    m.pullRequests * ACTIVITY_WEIGHTS.pullRequests +
    m.reviews * ACTIVITY_WEIGHTS.reviews +
    m.issues * ACTIVITY_WEIGHTS.issues
  );
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8"));
}

async function writeAtomic(file, payload) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, file + ".tmp");
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, path.join(DATA_DIR, file));
}

async function main() {
  const users = await readJson("users.json");
  const contributions = await readJson("contributions.json");
  const metrics = contributions.metrics ?? {};

  const developers = [];
  let missing = 0;
  let zeroActivity = 0;

  for (const user of users.users) {
    const key = user.login.toLowerCase();
    const m = metrics[key];
    if (!m || m.missing) {
      missing += 1;
      continue;
    }
    const totalContributions =
      m.commits + m.pullRequests + m.issues + m.reviews + m.privateContributions;
    if (totalContributions === 0) {
      zeroActivity += 1;
      continue;
    }
    developers.push({
      id: user.id,
      login: m.login ?? user.login,
      name: m.name ?? null,
      avatarUrl: m.avatarUrl ?? user.avatarUrl,
      profileUrl:
        m.profileUrl ?? `https://github.com/${encodeURIComponent(user.login)}`,
      followers: m.followers ?? null, // profile metric only — never affects rank
      commits: m.commits,
      pullRequests: m.pullRequests,
      issues: m.issues,
      reviews: m.reviews,
      privateContributions: m.privateContributions,
      totalContributions,
      activityScore: activityScore(m),
    });
  }

  // Main ranking: total contributions desc, username asc as tie-breaker.
  developers.sort(
    (a, b) =>
      b.totalContributions - a.totalContributions ||
      a.login.localeCompare(b.login),
  );
  developers.forEach((d, i) => {
    d.rank = i + 1;
  });

  const leaderboard = {
    generatedAt: new Date().toISOString(),
    region: "Nepal",
    query: users.query,
    window: contributions.window,
    includesPrivateContributions: true,
    methodology: {
      followerThreshold: null,
      note: "Every GitHub account matching location:nepal is considered; no follower-count gate.",
      formula:
        "totalContributions = commits + pullRequests + issues + reviews + privateContributions",
    },
    stats: {
      reportedBySearch: users.totalReportedBySearch,
      discoveredUsers: users.uniqueUsers,
      fetchedProfiles: Object.values(metrics).filter((m) => !m.missing).length,
      missingProfiles: missing,
      inactiveUsers: zeroActivity,
      rankedUsers: developers.length,
      minContributionsListed: developers.at(-1)?.totalContributions ?? 0,
    },
    developers,
  };

  await writeAtomic("leaderboard.json", leaderboard);

  // Compact machine-readable variant, in the spirit of committers.top's
  // rank_only/<region>.json.
  await writeAtomic(
    "rank_only.json",
    leaderboard.developers.map((d) => ({
      rank: d.rank,
      username: d.login,
      name: d.name,
      totalContributions: d.totalContributions,
    })),
  );

  console.log("--- leaderboard summary ---");
  console.log(`discovered users     : ${leaderboard.stats.discoveredUsers}`);
  console.log(`missing profiles     : ${leaderboard.stats.missingProfiles}`);
  console.log(`inactive (0 contribs): ${leaderboard.stats.inactiveUsers}`);
  console.log(`ranked developers    : ${leaderboard.stats.rankedUsers}`);
  console.log(`top contributor      : @${developers[0]?.login} (${developers[0]?.totalContributions})`);
  console.log("written to data/leaderboard.json and data/rank_only.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
