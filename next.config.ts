import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app reads the prebuilt leaderboard snapshot from disk at request time.
  // Explicitly include data/ in the serverless trace so it survives deployment
  // to Vercel (dynamic fs reads are not always traced automatically).
  outputFileTracingIncludes: {
    "/": ["./data/**/*"],
    "/api/developers": ["./data/**/*"],
  },
};

export default nextConfig;
