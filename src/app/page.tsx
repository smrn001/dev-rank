import Link from "next/link";
import { loadLeaderboard, formatNumber } from "@/lib/leaderboard";

const PAGE_SIZE = 100;

type SearchParams = Record<string, string | string[] | undefined>;

function pageParam(sp: SearchParams): number {
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const n = Number(raw ?? "1");
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const board = await loadLeaderboard();

  if (!board) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 px-6 py-16">
        <h1 className="text-2xl font-semibold">Nepal DevRank</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          No leaderboard snapshot found. Build one with:
        </p>
        <pre className="rounded-lg bg-zinc-100 p-4 font-mono text-sm dark:bg-zinc-900">
          npm run collect
        </pre>
      </main>
    );
  }

  const totalPages = Math.max(
    1,
    Math.ceil(board.developers.length / PAGE_SIZE),
  );
  const page = Math.min(pageParam(sp), totalPages);
  const slice = board.developers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const generated = new Date(board.generatedAt);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Nepal DevRank
        </h1>
        <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">
          Most active GitHub users in Nepal over the past year.
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="font-medium text-zinc-900 dark:text-zinc-100">
              {formatNumber(board.stats.discoveredUsers)}
            </strong>{" "}
            users discovered
          </li>
          <li>
            <strong className="font-medium text-zinc-900 dark:text-zinc-100">
              {formatNumber(board.stats.rankedUsers)}
            </strong>{" "}
            ranked
          </li>
          <li>no follower threshold</li>
          <li>
            generated{" "}
            <time dateTime={generated.toISOString()}>
              {generated.toISOString().slice(0, 10)}
            </time>
          </li>
        </ul>
      </header>

      {/* Methodology */}
      <details className="mb-6 rounded-xl border border-zinc-200 p-4 text-sm open:bg-zinc-50 dark:border-zinc-800 dark:open:bg-zinc-900/60">
        <summary className="cursor-pointer font-medium">
          How this list is generated
        </summary>
        <div className="mt-3 space-y-3 text-zinc-600 dark:text-zinc-400">
          <p>
            Every GitHub account whose profile location matches{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800">
              location:nepal
            </code>{" "}
            is considered — unlike committers.top, there is no
            &ldquo;top&nbsp;1000 by followers&rdquo; gate, so low-follower
            developers are never excluded.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs leading-relaxed dark:bg-zinc-900">
{`githubUsers.filter(_.location =~ Nepal)
           .all()                  // no follower limit
           .sort(_.contributions)`}
          </pre>
          <p>
            Contributions cover the past year and include private work:
            <br />
            <span className="font-mono text-[0.85em]">
              total = commits + PRs + issues + reviews + private contributions
            </span>
          </p>
          <p>
            Machine-readable JSON is available at{" "}
            <Link href="/api/developers" className="underline underline-offset-2">
              /api/developers
            </Link>
            . Followers are shown as a profile metric only and never affect the
            ranking.
          </p>
        </div>
      </details>

      {/* Leaderboard */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/80">
              <th className="px-3 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">User</th>
              <th className="px-3 py-2.5 text-right font-medium">Contribs</th>
              <th className="px-3 py-2.5 text-right font-medium">Commits</th>
              <th className="px-3 py-2.5 text-right font-medium">PRs</th>
              <th className="px-3 py-2.5 text-right font-medium">Reviews</th>
              <th className="px-3 py-2.5 text-right font-medium">Issues</th>
              <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">
                Private
              </th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {slice.map((d) => (
              <tr
                key={d.id}
                className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-900/40"
              >
                <td className="px-3 py-2 tabular-nums text-zinc-500 dark:text-zinc-400">
                  {formatNumber(d.rank)}.
                </td>
                <td className="max-w-[220px] truncate px-3 py-2">
                  <a
                    href={d.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {d.login}
                  </a>
                  {d.name ? (
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {" "}
                      ({d.name})
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatNumber(d.totalContributions)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatNumber(d.commits)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatNumber(d.pullRequests)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatNumber(d.reviews)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatNumber(d.issues)}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-zinc-600 sm:table-cell dark:text-zinc-400">
                  {formatNumber(d.privateContributions)}
                </td>
                <td className="px-3 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- avatars come pre-sized from GitHub's CDN; the optimizer would add nothing */}
                  <img
                    src={`${d.avatarUrl}&s=48`}
                    alt={`Avatar for ${d.login}`}
                    width={28}
                    height={28}
                    loading="lazy"
                    className="rounded-full"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link
              href={page === 2 ? "/" : `/?page=${page - 1}`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500 dark:text-zinc-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/?page=${page + 1}`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Rankings measure publicly observable GitHub activity — not developer
        quality. Data via the GitHub API; profiles link back to GitHub.
      </footer>
    </main>
  );
}
