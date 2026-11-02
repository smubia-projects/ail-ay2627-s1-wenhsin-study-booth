import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { aiConfigured, describeAiError, fullAiError, missingAiConfig } from "../lib/ai";
import { suggestCaptions } from "../lib/captions";
import { moderatePost } from "../lib/moderation";
import { writeStory } from "../lib/story";
import { limitCaption, limitModerate, limitStory } from "./rateLimit";

/**
 * Study Booth API (Cloud Run). API-only and stateless: the Next.js app is on Vercel, keeps the visitor's own
 * posts in the browser, and sends each image in the request body. Nothing is stored here.
 *
 *   GET  /api/health        -> {"status":"ok"}
 *   POST /api/moderate      { image?, text? } (at least one)              -> { status, allowed, message, readText }  [moderate]
 *   POST /api/caption       { image, localTime, minutesStudied?, recentCaptions? } -> { suggestions }      [caption]
 *   POST /api/weekly-story  { stats }                                     -> { title, story, stats }        [story]
 *
 * Each route validates first, then the rate limiter counts the hit, then the model is called.
 * (The original ran these as Next.js routes against Supabase; see original-supabase/.)
 */

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    // No CORS_ORIGINS set (local dev) -> allow any origin. Otherwise only the listed ones.
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)),
  }),
);

// A webcam post is a ~640x480 JPEG data URL, well under 3 MB (the original's cap).
const MAX_IMAGE_CHARS = 3_000_000;
const json = express.json({ limit: "4mb" });
const isImage = (v: unknown): v is string =>
  typeof v === "string" && v.length <= MAX_IMAGE_CHARS && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v);

const HELD_ERROR = "We couldn't check your post right now, so it wasn't shared. Please try again in a minute.";

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ai: aiConfigured() });
});

const needsImage: RequestHandler = (req, res, next) => {
  if (!isImage(req.body?.image)) return res.status(400).json({ error: "Send the post as a JPEG or PNG data URL." });
  next();
};

const needsAi: RequestHandler = (_req, res, next) => {
  if (!aiConfigured()) return res.status(501).json({ error: `AI isn't set up on the server (missing ${missingAiConfig()}).` });
  next();
};

// Every app post has an image; text-only requests are for the red-team suite (redteam/run.mjs).
const needsImageOrText: RequestHandler = (req, res, next) => {
  const { image, text } = req.body ?? {};
  const hasText = typeof text === "string" && text.trim().length > 0;
  if (image !== undefined ? !isImage(image) : !hasText) {
    return res.status(400).json({ error: "Send the post as a JPEG or PNG data URL (or text)." });
  }
  next();
};

// Moderation fails closed: any error means the post is held, never shared.
app.post("/api/moderate", json, needsImageOrText, needsAi, limitModerate, async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.slice(0, 600) : "";
  try {
    const decision = await moderatePost({ imageBase64: req.body.image, typedText: text, timeoutMs: 20_000 });
    const allowed = decision.allowed && decision.category === "ok";
    return res.json({
      status: allowed ? "approved" : "held",
      allowed,
      message: allowed ? "Sent!" : decision.reason,
      reason: decision.reason,
      category: decision.category,
      readText: decision.readText,
    });
  } catch (e) {
    const why = describeAiError(e);
    console.error(`moderation failed: ${why}`, JSON.stringify(fullAiError(e)));
    return res.status(502).json({ status: "held", allowed: false, message: `${HELD_ERROR} (${why})`, reason: `error: ${why}` });
  }
});

app.post("/api/caption", json, needsImage, needsAi, limitCaption, async (req, res) => {
  const b = req.body as { image: string; localTime?: unknown; minutesStudied?: unknown; recentCaptions?: unknown };
  try {
    const suggestions = await suggestCaptions({
      imageBase64: b.image,
      localTime: typeof b.localTime === "string" ? b.localTime.slice(0, 40) : new Date().toUTCString(),
      minutesStudied: typeof b.minutesStudied === "number" && b.minutesStudied >= 0 ? Math.round(b.minutesStudied) : null,
      recentCaptions: Array.isArray(b.recentCaptions) ? b.recentCaptions.map((c) => String(c).slice(0, 140)).slice(0, 3) : [],
      timeoutMs: Number(process.env.CAPTION_TIMEOUT_MS) || 8000,
    });
    return res.json({ suggestions });
  } catch (e) {
    console.warn("captions unavailable", JSON.stringify(fullAiError(e)));
    return res.status(502).json({ error: "No caption ideas right now. Write your own, or try again." });
  }
});

const STAT_KEYS = ["total_hours", "study_sessions", "days_studied", "longest_streak_days", "late_night_sessions", "posts"];

app.post("/api/weekly-story", json, (req, res, next) => {
  const raw = (req.body?.stats ?? {}) as Record<string, unknown>;
  const stats: Record<string, number> = {};
  for (const k of STAT_KEYS) {
    const v = Number(raw[k] ?? 0);
    if (!Number.isFinite(v) || v < 0 || v > 10_000) return res.status(400).json({ error: "Those stats don't look right." });
    stats[k] = Math.round(v * 10) / 10;
  }
  res.locals.stats = stats;
  next();
}, needsAi, limitStory, async (_req, res) => {
  const stats = res.locals.stats as Record<string, number>;
  try {
    const result = await writeStory(stats, 30_000);
    return res.json({ ...result, stats });
  } catch (e) {
    console.warn("weekly story failed", JSON.stringify(fullAiError(e)));
    return res.status(502).json({ error: "The story writer is taking a nap. Try again in a minute.", stats });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found. This is the Study Booth API; the app itself is on the frontend." });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs the 4-argument signature
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = Number((err as { status?: number }).status) || 500;
  if (status === 413) return res.status(413).json({ error: "That post is too large." });
  if (status === 400) return res.status(400).json({ error: "Expected JSON." });
  console.error(err);
  return res.status(500).json({ error: "Something went wrong on the server." });
};
app.use(onError);

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`Study Booth API listening on 0.0.0.0:${port}`);
});
