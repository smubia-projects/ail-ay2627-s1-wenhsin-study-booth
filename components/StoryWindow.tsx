"use client";

import { useState } from "react";
import { useBooth, type StudyLogEntry } from "@/components/BoothProvider";
import { api, LimitError } from "@/lib/api";

type Stats = Record<string, number>;

const LABELS: [string, string][] = [
  ["total_hours", "hours studied"],
  ["study_sessions", "study sessions"],
  ["days_studied", "days with studying"],
  ["longest_streak_days", "day streak"],
  ["late_night_sessions", "late-night sessions"],
  ["posts", "posts shared"],
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// The three demo friends' week (the original computed the whole group's week in SQL).
const FRIENDS_WEEK = { hours: 14.5, sessions: 11, days: new Set([1, 2, 3, 5, 6]), late: 2, posts: 9 };

function dayKey(t: number) {
  const d = new Date(t);
  return Math.floor((t - d.getTimezoneOffset() * 60_000) / 86_400_000);
}

/** This week's group stats: your sessions from this browser plus the demo friends'. Plain arithmetic, no AI. */
function weekStats(log: StudyLogEntry[], myPosts: number): Stats {
  const now = Date.now();
  const week = log.filter((s) => now - s.startedAt < WEEK_MS);
  const ms = week.reduce((sum, s) => sum + Math.max(0, s.endedAt - s.startedAt), 0);
  const today = dayKey(now);
  const days = new Set([...FRIENDS_WEEK.days].map((ago) => today - ago));
  for (const s of week) days.add(dayKey(s.startedAt));
  let streak = 0;
  for (let best = 0, d = today - 7; d <= today; d++) {
    best = days.has(d) ? best + 1 : 0;
    streak = Math.max(streak, best);
  }
  const late = week.filter((s) => new Date(s.startedAt).getHours() < 4).length;
  return {
    total_hours: Math.round((FRIENDS_WEEK.hours + ms / 3_600_000) * 10) / 10,
    study_sessions: FRIENDS_WEEK.sessions + week.length,
    days_studied: [...days].filter((d) => d > today - 7).length,
    longest_streak_days: streak,
    late_night_sessions: FRIENDS_WEEK.late + late,
    posts: FRIENDS_WEEK.posts + myPosts,
  };
}

export default function StoryWindow() {
  const { group, studyLog, posts, me } = useBooth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title?: string; story?: string; stats?: Stats; error?: string } | null>(null);

  async function generate() {
    setLoading(true);
    const myPosts = posts.filter((p) => p.user_id === me?.id && p.status === "approved").length;
    const stats = weekStats(studyLog, myPosts);
    try {
      setResult(await api<{ title: string; story: string; stats: Stats }>("/api/weekly-story", { stats }, 40_000));
    } catch (e) {
      setResult({ error: e instanceof LimitError ? e.message : "The story writer is taking a nap. Try again in a minute.", stats });
    } finally {
      setLoading(false);
    }
  }

  if (!group) return null;

  return (
    <div className="stack">
      <button className="pill-pink" onClick={generate} disabled={loading}>
        {loading ? "Writing your story..." : "Generate this week's story"}
      </button>
      {result?.error && <p className="hint">{result.error}</p>}
      {result?.story && (
        <div className="story-paper">
          <h3>{result.title}</h3>
          {result.story.split(/\n+/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}
      {result?.stats && (
        <ul className="stat-row">
          {LABELS.map(([key, label]) => (
            <li key={key}>
              <b>{result.stats![key] ?? 0}</b> {label}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        The numbers are counted from your study timer in this browser plus the demo friends&apos; week; the AI only writes
        the words.
      </p>
    </div>
  );
}
