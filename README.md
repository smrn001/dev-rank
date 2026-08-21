# Nepal DevRank

A transparent leaderboard of the most active GitHub users in Nepal — like
[committers.top/nepal_private](https://committers.top/nepal_private), but
**without the follower limit**.

Where committers.top does:

```
githubUsers.sort(_.followers)
           .filter(_.location == 'Nepal')
           .take(1000)        // <-- follower gate: silently drops ~95% of devs
           .sort(_.contributions)
           .take(256)
```

…this project considers **every** GitHub account matching `location:nepal`
and ranks all of them by total contributions (commits + PRs + issues + reviews +
private contributions over the past year). Followers are displayed as a profile
metric only and never affect the ranking.

## How it works

The GitHub Search API never returns more than 1,000 results per query, so the
collector partitions the population into `followers:<lo>..<hi>` buckets small
enough to fit (falling back to creation-date splits for saturated buckets,
e.g. the 9,500+ Nepali accounts with zero followers). Contribution counts come
from batched GraphQL `contributionsCollection` queries.

```
GitHub API → discover-users → fetch-contributions → build-leaderboard → data/*.json → Next.js UI
```

## Collecting data

Requires `GITHUB_TOKEN` in `.env.local` (classic token; `public_repo` scope is
enough — only public data is read).

```bash
npm run collect   # discover + fetch + rank (resumable; re-runs skip finished work)
# or run each step:
npm run discover  # -> data/users.json          (~21k users, ~5 min)
npm run fetch     # -> data/contributions.json   (~10 min, checkpoints per batch)
npm run rank      # -> data/leaderboard.json, data/rank_only.json
```

## Running the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the leaderboard.
Machine-readable JSON: [`/api/developers`](http://localhost:3000/api/developers)
(`?all=1` for everything, or `?page=2&perPage=50`).

## Hosting (GitHub + Vercel)

1. **Push to GitHub** — the repo already lives at `github.com/smrn001/dev-rank`.
   `data/leaderboard.json` and `data/rank_only.json` are committed so Vercel can
   serve them; the big intermediates (`users.json`, `contributions.json`) are
   gitignored.

2. **Deploy on Vercel** — at [vercel.com/new](https://vercel.com/new), import
   `smrn001/dev-rank`. The Next.js preset is auto-detected; no environment
   variables are needed to *serve* the site (the app never calls the GitHub API
   per request — it reads the committed snapshot). Every push to `main`
   redeploys automatically.

3. **Keep data fresh with GitHub Actions** —
   `.github/workflows/refresh-leaderboard.yml` reruns the full pipeline daily,
   commits updated snapshots, and the push triggers a Vercel redeploy.
   One-time setup:
   - Create a classic PAT ([github.com/settings/tokens](https://github.com/settings/tokens)) with `public_repo` scope.
   - Add it as the repository secret `COLLECT_GITHUB_TOKEN`
     (*Settings → Secrets and variables → Actions*).
   - Run it once manually via *Actions → refresh-leaderboard → Run workflow*.

## Notes

- Rankings measure publicly observable GitHub activity — not developer quality.
- Only public GitHub data is used; profiles link back to GitHub.
- The ranking window is the past year (`contributionsCollection` default).
