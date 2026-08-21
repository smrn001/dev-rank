/**
 * Leaderboard data access for the web app.
 *
 * The ranking is produced offline by scripts/collect.mjs into
 * data/leaderboard.json; the frontend only reads that snapshot and never
 * calls the GitHub API per request (PRD §23).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export type Developer = {
  rank: number;
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  profileUrl: string;
  /** Profile metric only — never affects ranking. */
  followers: number | null;
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  privateContributions: number;
  totalContributions: number;
};

export type Leaderboard = {
  generatedAt: string;
  region: string;
  query: string;
  window: string;
  includesPrivateContributions: boolean;
  methodology: {
    followerThreshold: null;
    note: string;
    formula: string;
  };
  stats: {
    reportedBySearch: number;
    discoveredUsers: number;
    fetchedProfiles: number;
    missingProfiles: number;
    inactiveUsers: number;
    rankedUsers: number;
    minContributionsListed: number;
  };
  developers: Developer[];
};

/** PRD §12 weights, kept for the alternative weighted metric (informational). */
export const ACTIVITY_WEIGHTS = {
  commits: 1,
  pullRequests: 3,
  reviews: 2,
  issues: 1,
} as const;

export function activityScore(d: Pick<Developer, keyof typeof ACTIVITY_WEIGHTS>) {
  return (
    d.commits * ACTIVITY_WEIGHTS.commits +
    d.pullRequests * ACTIVITY_WEIGHTS.pullRequests +
    d.reviews * ACTIVITY_WEIGHTS.reviews +
    d.issues * ACTIVITY_WEIGHTS.issues
  );
}

/**
 * Load the current leaderboard snapshot. Returns null when the collection
 * pipeline has not been run yet.
 */
export async function loadLeaderboard(): Promise<Leaderboard | null> {
  const file = path.join(process.cwd(), "data", "leaderboard.json");
  try {
    return JSON.parse(await readFile(file, "utf8")) as Leaderboard;
  } catch {
    return null;
  }
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
