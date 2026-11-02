"use client";

// Everything the booth needs from Supabase: your profile and group, the last
// 24 hours of posts (live via Realtime), reveals, reports, check-ins and the
// study session. Shared by the main desktop and the pop-out widget.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

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
export type SendResult = { status: "approved" | "held"; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_MS = 3 * 60 * 60 * 1000; // check-in sticky notes stay up for 3 hours
const MAX_POSTS = 30;
const SIGNED_URL_SECONDS = 60 * 60;
const HEARTBEAT_MS = 5 * 60 * 1000;
const GROUP_KEY = "studybooth.groupId";
const SESSION_KEY = "studybooth.session";

type BoothState = {
  supabase: SupabaseClient;
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
  loading: boolean;
  error: string;
  nameOf: (userId: string) => string;
  selectGroup: (id: string) => void;
  createGroup: (name: string) => Promise<void>;
  joinGroup: (code: string) => Promise<void>;
  leaveGroup: () => Promise<void>;
  renameMe: (name: string) => Promise<void>;
  /** Sends to `groupId`, or to the group you are looking at. */
  sendPost: (p: { image: string; kind: PostKind; caption?: string; noteText?: string; groupId?: string }) => Promise<SendResult>;
  deletePost: (post: Post) => Promise<void>;
  reveal: (postId: string) => Promise<void>;
  report: (postId: string, reason: string) => Promise<void>;
  startStudy: (minutes: number, focus: boolean) => Promise<void>;
  stopStudy: () => Promise<void>;
  setFocus: (focus: boolean) => void;
  refresh: () => Promise<void>;
};

const BoothContext = createContext<BoothState | null>(null);

export function useBooth() {
  const ctx = useContext(BoothContext);
  if (!ctx) throw new Error("useBooth must be used inside <BoothProvider>");
  return ctx;
}

function errorText(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong.";
}

export function BoothProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [me, setMe] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  // Study session, restored after a reload while its timer is still running.
  const [session, setSession] = useState<StudySession | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null") as StudySession | null;
      return saved && saved.endsAt > Date.now() ? saved : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const urlCache = useRef<Record<string, string>>({});

  const group = groups.find((g) => g.id === groupId) ?? null;

  // ---- profile and groups
  const loadGroups = useCallback(async () => {
    const [{ data: profile }, { data: rows, error: gErr }] = await Promise.all([
      supabase.from("profiles").select("id, display_name").eq("id", userId).maybeSingle(),
      supabase.from("group_members").select("groups(id, name, invite_code)").eq("user_id", userId),
    ]);
    if (gErr) {
      setError(
        gErr.code === "42P01" || gErr.message.includes("does not exist")
          ? "The database isn't set up yet. Run supabase/migrations/0001_init.sql in the Supabase SQL editor."
          : gErr.message,
      );
      setLoading(false);
      return;
    }
    setMe(profile ?? { id: userId, display_name: "you" });
    const list = (rows ?? []).flatMap((r) => (r.groups ? [r.groups as unknown as Group] : []));
    setGroups(list);
    setGroupId((current) => {
      if (current && list.some((g) => g.id === current)) return current;
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(GROUP_KEY);
      } catch {}
      return list.find((g) => g.id === saved)?.id ?? list[0]?.id ?? null;
    });
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    // Fetching from Supabase on mount; state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroups();
  }, [loadGroups]);

  // ---- posts, members, reveals, reports, check-ins for the current group
  const loadGroupData = useCallback(async () => {
    if (!groupId) return;
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const notesSince = new Date(Date.now() - NOTE_MS).toISOString();
    const [postsRes, membersRes, checkinsRes, reportsRes] = await Promise.all([
      supabase
        .from("posts")
        .select("*")
        .eq("group_id", groupId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_POSTS),
      supabase.from("group_members").select("user_id").eq("group_id", groupId),
      supabase
        .from("checkins")
        .select("*")
        .eq("group_id", groupId)
        .gte("created_at", notesSince)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase.from("reports").select("post_id").eq("reporter_id", userId),
    ]);
    const list = (postsRes.data ?? []) as Post[];
    setPosts(list);
    setCheckins((checkinsRes.data ?? []) as Checkin[]);
    setReported(new Set((reportsRes.data ?? []).map((r) => r.post_id as string)));

    const memberIds = (membersRes.data ?? []).map((m) => m.user_id as string);
    if (memberIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", memberIds);
      setMembers((profiles ?? []) as Profile[]);
    }

    if (list.length) {
      const { data: reveals } = await supabase
        .from("post_reveals")
        .select("post_id")
        .eq("user_id", userId)
        .in(
          "post_id",
          list.map((p) => p.id),
        );
      setRevealed(new Set((reveals ?? []).map((r) => r.post_id as string)));

      // Short-lived signed URLs for the private bucket; reuse ones we already have.
      const missing = list.map((p) => p.image_path).filter((path) => !urlCache.current[path]);
      if (missing.length) {
        const { data: signed } = await supabase.storage.from("posts").createSignedUrls(missing, SIGNED_URL_SECONDS);
        for (const s of signed ?? []) if (s.path && s.signedUrl) urlCache.current[s.path] = s.signedUrl;
        setImageUrls({ ...urlCache.current });
      }
    }
  }, [supabase, groupId, userId]);

  useEffect(() => {
    if (!groupId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch, state set after it resolves
    void loadGroupData();
    // Live updates; a slow poll covers the case where Realtime isn't enabled.
    const channel = supabase
      .channel(`group-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `group_id=eq.${groupId}` }, () => {
        void loadGroupData();
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "checkins", filter: `group_id=eq.${groupId}` },
        (payload) => setCheckins((c) => [payload.new as Checkin, ...c].slice(0, 3)),
      )
      .subscribe();
    const poll = window.setInterval(() => void loadGroupData(), 60_000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [supabase, groupId, loadGroupData]);

  const saveSession = (s: StudySession | null) => {
    setSession(s);
    try {
      if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else window.localStorage.removeItem(SESSION_KEY);
    } catch {}
  };

  const stopStudy = useCallback(async () => {
    const current = session;
    saveSession(null);
    if (current) await supabase.from("study_sessions").update({ ended_at: new Date().toISOString() }).eq("id", current.id);
  }, [session, supabase]);

  // End the session when the timer runs out, heartbeat while it runs, and
  // close it if the tab is closed.
  useEffect(() => {
    if (!session) return;
    const left = session.endsAt - Date.now();
    const end = window.setTimeout(() => void stopStudy(), Math.max(0, left));
    const beat = window.setInterval(() => {
      void supabase.from("study_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
    }, HEARTBEAT_MS);
    const onHide = () => {
      navigator.sendBeacon?.("/api/session/end", JSON.stringify({ sessionId: session.id }));
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearTimeout(end);
      window.clearInterval(beat);
      window.removeEventListener("pagehide", onHide);
    };
  }, [session, stopStudy, supabase]);

  // ---- actions
  const value: BoothState = {
    supabase,
    me,
    groups,
    group,
    members,
    posts,
    imageUrls,
    revealed,
    reported,
    checkins,
    session,
    loading,
    error,
    nameOf: (id) => (id === userId ? "You" : (members.find((m) => m.id === id)?.display_name ?? "A friend")),
    selectGroup: (id) => {
      setGroupId(id);
      try {
        window.localStorage.setItem(GROUP_KEY, id);
      } catch {}
    },
    createGroup: async (name) => {
      const { data, error: e } = await supabase.rpc("create_group", { p_name: name });
      if (e) throw new Error(errorText(e));
      await loadGroups();
      value.selectGroup((data as Group).id);
    },
    joinGroup: async (code) => {
      const { data, error: e } = await supabase.rpc("join_group", { p_code: code });
      if (e) throw new Error(errorText(e).includes("invite code") ? "No group with that invite code." : errorText(e));
      await loadGroups();
      value.selectGroup((data as Group).id);
    },
    leaveGroup: async () => {
      if (!groupId) return;
      await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
      setGroupId(null);
      setPosts([]);
      await loadGroups();
    },
    renameMe: async (name) => {
      const clean = name.trim().slice(0, 30);
      if (!clean) return;
      const { error: e } = await supabase.from("profiles").update({ display_name: clean }).eq("id", userId);
      if (e) throw new Error(errorText(e));
      setMe((m) => (m ? { ...m, display_name: clean } : m));
      setMembers((list) => list.map((m) => (m.id === userId ? { ...m, display_name: clean } : m)));
    },
    sendPost: async ({ image, kind, caption, noteText, groupId: to }) => {
      const target = to ?? groupId;
      if (!target || !groups.some((g) => g.id === target)) throw new Error("Join or create a group first.");
      const id = crypto.randomUUID();
      const path = `${target}/${userId}/${id}.jpg`;
      const blob = await (await fetch(image)).blob();
      const up = await supabase.storage.from("posts").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      const ins = await supabase.from("posts").insert({
        id,
        group_id: target,
        user_id: userId,
        kind,
        image_path: path,
        caption: caption?.trim() || null,
        note_text: noteText?.trim() || null,
      });
      if (ins.error) {
        await supabase.storage.from("posts").remove([path]);
        throw new Error(`Couldn't save the post: ${ins.error.message}`);
      }
      // Show the post to its author straight away (as "Checking…") while moderation runs.
      void loadGroupData();
      // Moderation decides whether friends ever see it. Any failure leaves it held.
      let result: SendResult = {
        status: "held",
        message: "We couldn't check your post right now, so it wasn't shared. Try again in a minute.",
      };
      try {
        const res = await fetch("/api/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId: id }),
          signal: AbortSignal.timeout(25_000),
        });
        const body = (await res.json()) as { status?: string; message?: string };
        if (res.ok && body.status === "approved") result = { status: "approved", message: "Sent!" };
        else if (body.message) result = { status: "held", message: body.message };
      } catch {}
      await loadGroupData();
      return result;
    },
    deletePost: async (post) => {
      await supabase.from("posts").delete().eq("id", post.id).eq("user_id", userId);
      await supabase.storage.from("posts").remove([post.image_path]);
      setPosts((list) => list.filter((p) => p.id !== post.id));
    },
    reveal: async (postId) => {
      setRevealed((s) => new Set(s).add(postId));
      await supabase.from("post_reveals").insert({ post_id: postId, user_id: userId });
    },
    report: async (postId, reason) => {
      setReported((s) => new Set(s).add(postId));
      await supabase.from("reports").insert({ post_id: postId, reporter_id: userId, reason: reason.slice(0, 300) });
    },
    startStudy: async (minutes, focus) => {
      if (!groupId) throw new Error("Join or create a group first.");
      const { data, error: e } = await supabase
        .from("study_sessions")
        .insert({ user_id: userId, group_id: groupId })
        .select("id, started_at")
        .single();
      if (e) throw new Error(errorText(e));
      const startedAt = new Date(data.started_at as string).getTime();
      saveSession({ id: data.id as string, startedAt, endsAt: startedAt + minutes * 60_000, focus });
    },
    stopStudy,
    setFocus: (focus) => session && saveSession({ ...session, focus }),
    refresh: loadGroupData,
  };

  return <BoothContext.Provider value={value}>{children}</BoothContext.Provider>;
}
