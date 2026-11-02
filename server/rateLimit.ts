import { createRateLimiter } from "./rateLimitEngine.js";

/**
 * Rate-limit adapter: the shared engine (rateLimitEngine.js) with this project's
 * slug and one bucket per AI route. The engine handles X-Forwarded-For, central
 * config from the control sheet, event mode, the kill switch (503) and fail-open.
 * Without Upstash credentials it is a no-op, which is what local dev wants.
 */
const limiter = createRateLimiter({
  // Slug = full project folder name (matches the central control-sheet rows).
  project: "ail-ay2627-s1-wenhsin-study-booth",
  buckets: {
    moderate: Number(process.env.RATE_LIMIT_MODERATE_MAX || 10),
    caption: Number(process.env.RATE_LIMIT_CAPTION_MAX || 10),
    story: Number(process.env.RATE_LIMIT_STORY_MAX || 3),
  },
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
  defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
});

export const limitModerate = limiter("moderate");
export const limitCaption = limiter("caption");
export const limitStory = limiter("story");
