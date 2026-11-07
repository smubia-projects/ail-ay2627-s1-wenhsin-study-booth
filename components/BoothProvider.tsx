"use client";

// Everything the booth needs, kept in this browser (AI Lodge showcase: no accounts, no database).
// Your own posts, reveals, reports and study sessions live in localStorage. The group is a seeded demo
// group of three friends whose posts ship with the app, so the feed, stories and scratch-to-reveal work
// for a single visitor. Each post you send goes to the API for AI moderation (image in the request body);
// only an approved post shows as shared. Shared by the main desktop and the pop-out widget.
// The original Supabase version (auth, groups, Realtime, private storage) is in original-supabase/.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, LimitError } from "@/lib/api";

export type Profile = { id: string; display_name: string };
export type Group = { id: string; name: string; invite_code: string };
export type PostKind = "fog" | "photo" | "note";
/** Display style of a post: Photo / Fog / Card. */
export function postStyle(post: { kind: PostKind }) {
  if (post.kind === "note") return "Card";
  return post.kind === "fog" ? "Fog" : "Photo";
}
export type Post = {
  id: string;
  group_id: string;
  user_id: string;
  kind: PostKind;
  image_path: string;
  caption: string | null;
  note_text: string | null;
  status: "pending" | "approved" | "held";
  moderation_reason: string | null;
  created_at: string;
};
export type Checkin = { id: string; group_id: string; message: string; created_at: string };
export type StudySession = { id: string; startedAt: number; endsAt: number; focus: boolean };
export type StudyLogEntry = { startedAt: number; endedAt: number };
export type SendResult = { status: "approved" | "held"; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OWN_POSTS = 12;
const ME_ID = "me";
const KEYS = {
  name: "studybooth.name",
  posts: "studybooth.posts",
  image: (id: string) => `studybooth.img.${id}`,
  revealed: "studybooth.revealed",
  reported: "studybooth.reported",
  session: "studybooth.session",
  log: "studybooth.studyLog",
};

export const DEMO_GROUP: Group = { id: "demo-group", name: "Study Buddies", invite_code: "DEMO42" };
export const FRIENDS: Profile[] = [
  { id: "friend-mei", display_name: "Mei" },
  { id: "friend-arjun", display_name: "Arjun" },
  { id: "friend-zoe", display_name: "Zoe" },
];
// Seeded friends' fog posts (images in public/demo), placed a few hours back so they sit in the 24-hour feed.
const SEED: { id: string; user: string; file: string; caption: string; minutesAgo: number }[] = [
  { id: "seed-1", user: "friend-mei", file: "friend-08.jpg", caption: "anyone else need snacks rn", minutesAgo: 25 },
  { id: "seed-2", user: "friend-zoe", file: "friend-06.jpg", caption: "group project crunch time", minutesAgo: 95 },
  { id: "seed-3", user: "friend-arjun", file: "friend-04.jpg", caption: "library till it closes", minutesAgo: 210 },
  { id: "seed-4", user: "friend-mei", file: "friend-03.jpg", caption: "for whoever has chem tomorrow", minutesAgo: 420 },
];

type BoothState = {
  me: Profile | null;
  groups: Group[];
  group: Group | null;
  members: Profile[];
  posts: Post[];
  imageUrls: Record<string, string>;
  revealed: Set<string>;
  reported: Set<string>;
  checkins: Checkin[];
  session: StudySession | null;
  studyLog: StudyLogEntry[];
  loading: boolean;
  error: string;
  nameOf: (userId: string) => string;
  selectGroup: (id: string) => void;
  renameMe: (name: string) => Promise<void>;
  /** Sends to the demo group. */
  sendPost: (p: { image: string; kind: PostKind; caption?: string; noteText?: string; groupId?: string }) => Promise<SendResult>;
  deletePost: (post: Post) => Promise<void>;
  reveal: (postId: string) => Promise<void>;
  report: (postId: string, reason: string) => Promise<void>;
  startStudy: (minutes: number, focus: boolean) => Promise<void>;
  stopStudy: () => Promise<void>;
  setFocus: (focus: boolean) => void;
  refresh: () => Promise<void>;
  /** Clears everything this browser saved for the demo. */
  resetDemo: () => void;
};

const BoothContext = createContext<BoothState | null>(null);

export function useBooth() {
  const ctx = useContext(BoothContext);
  if (!ctx) throw new Error("useBooth must be used inside <BoothProvider>");
  return ctx;
}

// ---- localStorage helpers (storage can be full, blocked or empty; never let that break the app)
function read<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function seedPosts(now: number): Post[] {
  return SEED.map((s) => ({
    id: s.id,
    group_id: DEMO_GROUP.id,
    user_id: s.user,
    kind: "fog",
    image_path: `/demo/${s.file}`,
    caption: s.caption,
    note_text: null,
    status: "approved",
    moderation_reason: null,
    created_at: new Date(now - s.minutesAgo * 60_000).toISOString(),
  }));
}

export function BoothProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("You");
  const [ownPosts, setOwnPosts] = useState<Post[]>([]);
  const [ownImages, setOwnImages] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState<Post[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<StudySession | null>(null);
  const [studyLog, setStudyLog] = useState<StudyLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const now = Date.now();
    const mine = read<Post[]>(KEYS.posts, []).filter((p) => now - new Date(p.created_at).getTime() < DAY_MS);
    const images: Record<string, string> = {};
    for (const p of mine) {
      const img = read<string | null>(KEYS.image(p.id), null);
      if (img) images[p.image_path] = img;
    }
    setOwnPosts(mine);
    setOwnImages(images);
    setSeeded(seedPosts(now));
    setName(read(KEYS.name, "You"));
    setRevealed(new Set(read<string[]>(KEYS.revealed, [])));
    setReported(new Set(read<string[]>(KEYS.reported, [])));
    const saved = read<StudySession | null>(KEYS.session, null);
    setSession(saved && saved.endsAt > now ? saved : null);
    setStudyLog(read<StudyLogEntry[]>(KEYS.log, []).filter((s) => now - s.startedAt < 8 * DAY_MS));
    setLoading(false);
  }, []);

  useEffect(() => {
    // Reads localStorage after mount (the server render has no storage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // The pop-out widget and other tabs share this storage; pick up their changes.
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("studybooth.")) void load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  const saveOwn = useCallback((list: Post[]) => {
    const kept = list.slice(0, MAX_OWN_POSTS);
    for (const p of list.slice(MAX_OWN_POSTS)) remove(KEYS.image(p.id));
    setOwnPosts(kept);
    write(KEYS.posts, kept);
  }, []);

  const updatePost = useCallback((id: string, patch: Partial<Post>) => {
    setOwnPosts((list) => {
      const next = list.map((p) => (p.id === id ? { ...p, ...patch } : p));
      write(KEYS.posts, next);
      return next;
    });
  }, []);

  const saveSession = (s: StudySession | null) => {
    setSession(s);
    if (s) write(KEYS.session, s);
    else remove(KEYS.session);
  };

  const stopStudy = useCallback(async () => {
    if (!session) return;
    const entry = { startedAt: session.startedAt, endedAt: Math.min(Date.now(), session.endsAt) };
    const log = [...read<StudyLogEntry[]>(KEYS.log, []), entry].slice(-100);
    write(KEYS.log, log);
    setStudyLog(log);
    saveSession(null);
  }, [session]);

  // End the session when the timer runs out.
  useEffect(() => {
    if (!session) return;
    const end = window.setTimeout(() => void stopStudy(), Math.max(0, session.endsAt - Date.now()));
    return () => window.clearTimeout(end);
  }, [session, stopStudy]);

  const posts = useMemo(
    () => [...ownPosts, ...seeded].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [ownPosts, seeded],
  );
  const imageUrls = useMemo(() => {
    const urls: Record<string, string> = { ...ownImages };
    for (const p of seeded) urls[p.image_path] = p.image_path;
    return urls;
  }, [ownImages, seeded]);
  const me: Profile = { id: ME_ID, display_name: name };

  const value: BoothState = {
    me,
    groups: [DEMO_GROUP],
    group: DEMO_GROUP,
    members: [me, ...FRIENDS],
    posts,
    imageUrls,
    revealed,
    reported,
    checkins: [],
    session,
    studyLog,
    loading,
    error: "",
    nameOf: (id) => (id === ME_ID ? "You" : (FRIENDS.find((m) => m.id === id)?.display_name ?? "A friend")),
    selectGroup: () => {},
    renameMe: async (n) => {
      const clean = n.trim().slice(0, 30);
      if (!clean) return;
      write(KEYS.name, clean);
      setName(clean);
    },
    sendPost: async ({ image, kind, caption, noteText }) => {
      const id = crypto.randomUUID();
      const path = `local:${id}`;
      if (!write(KEYS.image(id), image)) {
        // Storage full: drop the oldest of your posts' images and try once more.
        const oldest = ownPosts[ownPosts.length - 1];
        if (oldest) remove(KEYS.image(oldest.id));
        if (!write(KEYS.image(id), image)) throw new Error("This browser's storage is full. Delete an old post and try again.");
      }
      const post: Post = {
        id,
        group_id: DEMO_GROUP.id,
        user_id: ME_ID,
        kind,
        image_path: path,
        caption: caption?.trim() || null,
        note_text: noteText?.trim() || null,
        status: "pending",
        moderation_reason: null,
        created_at: new Date().toISOString(),
      };
      setOwnImages((m) => ({ ...m, [path]: image }));
      // Show the post to its author straight away (as "Checking…") while moderation runs.
      saveOwn([post, ...ownPosts]);

      // Moderation decides whether the post counts as shared. Any failure leaves it held (fails closed).
      const typedText = [post.note_text && `Note: ${post.note_text}`, post.caption && `Caption: ${post.caption}`]
        .filter(Boolean)
        .join("\n");
      let result: SendResult = {
        status: "held",
        message: "We couldn't check your post right now, so it wasn't shared. Try again in a minute.",
      };
      try {
        const res = await api<{ status?: string; message?: string }>("/api/moderate", { image, text: typedText });
        result = res.status === "approved" ? { status: "approved", message: "Sent!" } : { status: "held", message: res.message || result.message };
      } catch (e) {
        if (e instanceof LimitError) result = { status: "held", message: `${e.message} Your post wasn't checked, so it wasn't shared.` };
        else if (e instanceof Error && e.message) result = { status: "held", message: e.message };
      }
      updatePost(id, { status: result.status, moderation_reason: result.status === "held" ? result.message : null });
      return result;
    },
    deletePost: async (post) => {
      remove(KEYS.image(post.id));
      saveOwn(ownPosts.filter((p) => p.id !== post.id));
    },
    reveal: async (postId) => {
      setRevealed((s) => {
        const next = new Set(s).add(postId);
        write(KEYS.revealed, [...next]);
        return next;
      });
    },
    report: async (postId) => {
      setReported((s) => {
        const next = new Set(s).add(postId);
        write(KEYS.reported, [...next]);
        return next;
      });
    },
    startStudy: async (minutes, focus) => {
      const startedAt = Date.now();
      saveSession({ id: crypto.randomUUID(), startedAt, endsAt: startedAt + minutes * 60_000, focus });
    },
    stopStudy,
    setFocus: (focus) => session && saveSession({ ...session, focus }),
    refresh: load,
    resetDemo: () => {
      try {
        for (const k of Object.keys(window.localStorage)) if (k.startsWith("studybooth.")) window.localStorage.removeItem(k);
      } catch {}
      void load();
    },
  };

  return <BoothContext.Provider value={value}>{children}</BoothContext.Provider>;
}
