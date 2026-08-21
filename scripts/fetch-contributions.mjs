/**
 * Fetch per-user contribution metrics for every discovered Nepal user via the
 * GitHub GraphQL API, replicating committers.top's `_private` metric:
 *
 *   total = commits + pull requests + issues + PR reviews + private contributions
 *
 * over the past year (`contributionsCollection`'s default window).
 * `restrictedContributionsCount` is the private-repository contribution count,
 * which GitHub exposes to any authenticated viewer — verified empirically.
 *
 * The run is resumable: results are checkpointed into data/contributions.json
 * after every batch, and re-runs skip already-fetched logins.
 *
 * Input : data/users.json   (from discover-users.mjs)
 * Output: data/contributions.json
 */
import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { graphql } from "./lib/github.mjs";

const BATCH_SIZE = 60;
const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const OUT_FILE = path.join(DATA_DIR, "contributions.json");

const USER_FIELDS = /* GraphQL */ `
  login
  name
  avatarUrl(size: 96)
  url
  createdAt
  followers {
    totalCount
  }
  contributionsCollection {
    totalCommitContributions
    totalPullRequestContributions
    totalIssueContributions
    totalPullRequestReviewContributions
    restrictedContributionsCount
  }
`;

function buildBatchQuery(logins) {
  const aliases = logins
    .map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) { ${USER_FIELDS} }`)
    .join("\n");
  return /* GraphQL */ `
    query {
      rateLimit {
        cost
        remaining
        resetAt
      }
      ${aliases}
    }
  `;
}

async function loadExisting() {
  try {
    const raw = await readFile(OUT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.metrics ?? {};
  } catch {
    return {};
  }
}

async function save(metrics, extra) {
  await mkdir(DATA_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    window: "past year (contributionsCollection default)",
    includesPrivateContributions: true,
    ...extra,
    metrics,
  };
  const tmp = OUT_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(payload));
  await rename(tmp, OUT_FILE);
}

function recordFromUser(login, node) {
  if (!node) {
    // Account deleted/suspended/renamed between discovery and fetch.
    return { login, missing: true, fetchedAt: new Date().toISOString() };
  }
  const c = node.contributionsCollection;
  return {
    id: null, // filled from discovery data at merge time (GraphQL id omitted on purpose)
    login: node.login,
    name: node.name ?? null,
    avatarUrl: node.avatarUrl,
    profileUrl: node.url,
    createdAt: node.createdAt,
    followers: node.followers.totalCount,
    commits: c.totalCommitContributions,
    pullRequests: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    privateContributions: c.restrictedContributionsCount,
    fetchedAt: new Date().toISOString(),
  };
}

async function main() {
  const discovered = JSON.parse(await readFile(USERS_FILE, "utf8"));
  console.log(
    `discovered ${discovered.users.length} users (generatedAt=${discovered.generatedAt})`,
  );

  const metrics = await loadExisting();
  const pending = discovered.users.filter(
    (u) => metrics[u.login.toLowerCase()] === undefined,
  );
  console.log(
    `${Object.keys(metrics).length} already fetched, ${pending.length} to go`,
  );

  const startedAt = Date.now();
  let done = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const logins = batch.map((u) => u.login);
    const query = buildBatchQuery(logins);
    const data = await graphql(query);

    batch.forEach((user, j) => {
      const node = data[`u${j}`];
      const rec = recordFromUser(user.login, node);
      rec.id = user.id;
      rec.avatarUrl = rec.avatarUrl ?? user.avatarUrl;
      metrics[user.login.toLowerCase()] = rec;
    });

    done += batch.length;
    const cost = data.rateLimit?.cost ?? "?";
    const remaining = data.rateLimit?.remaining ?? "?";
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const eta =
      done > 0
        ? Math.round(((elapsed / done) * (pending.length - done)) / 60)
        : "?";
    console.log(
      `[${String(done).padStart(String(pending.length).length)}/${pending.length}] cost=${cost} pointsLeft=${remaining} elapsed=${elapsed}s eta=${eta}m`,
    );

    // Checkpoint periodically so re-runs never repeat much work.
    if (done % (BATCH_SIZE * 10) === 0 || done >= pending.length) {
      await save(metrics, { discoveredUsers: discovered.users.length });
    }
  }

  await save(metrics, { discoveredUsers: discovered.users.length });

  const fetched = Object.values(metrics).filter((m) => !m.missing);
  const withAnyActivity = fetched.filter(
    (m) => m.commits + m.pullRequests + m.issues + m.reviews > 0,
  );
  console.log("\n--- fetch summary ---");
  console.log(`total records     : ${Object.keys(metrics).length}`);
  console.log(`resolved profiles : ${fetched.length}`);
  console.log(`missing accounts  : ${Object.keys(metrics).length - fetched.length}`);
  console.log(`public activity>0 : ${withAnyActivity.length}`);
  console.log(`written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
