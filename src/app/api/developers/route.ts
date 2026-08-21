import { loadLeaderboard } from "@/lib/leaderboard";

/**
 * GET /api/developers?page=1&perPage=100
 *
 * Machine-readable leaderboard snapshot. Mirrors the page data; add
 * ?all=1 for the full list in one response.
 */
export async function GET(request: Request) {
  const board = await loadLeaderboard();
  if (!board) {
    return Response.json(
      { error: "leaderboard not built yet — run: npm run collect" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "1";
  const perPage = Math.min(
    Math.max(Number(url.searchParams.get("perPage") ?? 100) || 100, 1),
    500,
  );
  const totalPages = Math.max(1, Math.ceil(board.developers.length / perPage));
  const page = Math.min(
    Math.max(Number(url.searchParams.get("page") ?? 1) || 1, 1),
    totalPages,
  );

  const developers = all
    ? board.developers
    : board.developers.slice((page - 1) * perPage, page * perPage);

  return Response.json(
    {
      region: board.region,
      query: board.query,
      window: board.window,
      includesPrivateContributions: board.includesPrivateContributions,
      followerThreshold: null,
      generatedAt: board.generatedAt,
      stats: board.stats,
      pagination: all
        ? null
        : { page, perPage, totalPages, totalItems: board.developers.length },
      developers,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
