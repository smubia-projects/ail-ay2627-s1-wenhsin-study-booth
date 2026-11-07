"use client";

import { useState } from "react";
import FogBooth from "@/components/FogBooth";
import CardComposer from "@/components/CardComposer";
import { useBooth, type PostKind } from "@/components/BoothProvider";
import { api, LimitError } from "@/lib/api";

type Style = "photo" | "fog" | "card";
type Draft = { image: string; kind: PostKind; noteText?: string };

const STYLES: { id: Style; label: string; blurb: string; tone: "green" | "pink" | "blue" }[] = [
  { id: "photo", label: "Photo", blurb: "A quick snap, with a filter", tone: "green" },
  { id: "fog", label: "Fog glass", blurb: "Blow to fog, then write on it", tone: "pink" },
  { id: "card", label: "Card note", blurb: "Your words, handwritten on a pretty card", tone: "blue" },
];

/** Style → create → preview & share. */
export default function NewPost({ onShared }: { onShared: (ok: boolean, message: string, groupId: string) => void }) {
  const [style, setStyle] = useState<Style | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);
  const step = !style ? 1 : draft ? 3 : 2;

  return (
    <div className="stack">
      <ol className="steps" aria-label="Steps">
        {["Style", "Create", "Share"].map((label, i) => (
          <li key={label} className={step === i + 1 ? "current" : step > i + 1 ? "done" : ""} aria-current={step === i + 1 ? "step" : undefined}>
            <span>{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {!style ? (
        <div className="style-picker" role="group" aria-label="Choose a style">
          {STYLES.map((s, i) => (
            <button key={s.id} className={`style-option pill-${s.tone}`} onClick={() => setStyle(s.id)} data-autofocus={i === 0 ? true : undefined}>
              <b>{s.label}</b>
              <span>{s.blurb}</span>
            </button>
          ))}
          <p className="hint">
            📷 When you send a post (or ask for caption ideas), the finished image is sent to an AI model to check it and
            read any writing. The live camera, mic and hand tracking stay on your device.
          </p>
        </div>
      ) : (
        <>
          {!draft && (
            <div className="field-row">
              <button className="small" onClick={() => setStyle(null)}>
                ← Styles
              </button>
              <b>{STYLES.find((s) => s.id === style)!.label}</b>
            </div>
          )}
          {/* Keyed by style so switching restarts the camera with or without the mic. */}
          {style === "card" ? (
            !draft && (
              <CardComposer
                onCreated={(image, noteText) => {
                  setLastResult(null);
                  setDraft({ image, kind: "note", noteText });
                }}
              />
            )
          ) : (
            <FogBooth
              key={style}
              fog={style === "fog"}
              hidden={Boolean(draft)}
              onCapture={(image, kind) => {
                setLastResult(null);
                setDraft({ image, kind });
              }}
            />
          )}
          {draft && (
            <SendPreview
              draft={draft}
              onCancel={() => setDraft(null)}
              onDone={onShared}
              onError={(message) => setLastResult({ ok: false, message })}
            />
          )}
          {lastResult && (
            <p role="status" className={lastResult.ok ? "note-ok" : "note-held"}>
              {lastResult.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SendPreview({
  draft,
  onCancel,
  onDone,
  onError,
}: {
  draft: Draft;
  onCancel: () => void;
  /** The post was saved (shared, or held by moderation) in `groupId`. */
  onDone: (ok: boolean, message: string, groupId: string) => void;
  /** Nothing was saved; stay here so they can try again. */
  onError: (message: string) => void;
}) {
  const { group, groups, sendPost, posts, session } = useBooth();
  const [to, setTo] = useState(group?.id ?? "");
  const target = groups.find((g) => g.id === to) ?? group;
  const [caption, setCaption] = useState("");
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);

  const [thinking, setThinking] = useState(false);
  const [captionNote, setCaptionNote] = useState("");

  // Caption ideas only when asked (each one is an AI call). Slow or failed = no chips; posting still works.
  async function suggest() {
    setThinking(true);
    setCaptionNote("");
    try {
      const recentCaptions = posts.filter((p) => p.status === "approved" && p.caption).slice(0, 3).map((p) => p.caption);
      const d = await api<{ suggestions?: string[] }>(
        "/api/caption",
        {
          image: draft.image,
          localTime: new Date().toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" }),
          minutesStudied: session ? Math.round((Date.now() - session.startedAt) / 60_000) : null,
          recentCaptions,
        },
        12_000,
      );
      setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []);
    } catch (e) {
      setSuggestions([]);
      setCaptionNote(e instanceof LimitError ? e.message : "No caption ideas right now. Write your own, or try again.");
    } finally {
      setThinking(false);
    }
  }

  async function send() {
    if (!target) return;
    setSending(true);
    try {
      const result = await sendPost({
        image: draft.image,
        kind: draft.kind,
        caption,
        noteText: draft.noteText,
        groupId: target.id,
      });
      onDone(
        result.status === "approved",
        result.status === "approved" ? `Sent to ${target.name}! Your friends can scratch to reveal it.` : result.message,
        target.id,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="stack">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={draft.image} alt="Preview of your post" className="preview-photo" />
      <div className="field-row-stacked">
        <label htmlFor="caption">Caption (optional)</label>
        <input id="caption" type="text" maxLength={140} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </div>
      <div className="caption-chips" aria-live="polite">
        {suggestions === null && (
          <button type="button" className="small pill-blue" onClick={() => void suggest()} disabled={thinking || sending}>
            {thinking ? "Thinking of captions..." : "✨ Suggest captions"}
          </button>
        )}
        {captionNote && <span className="hint">{captionNote}</span>}
        {suggestions?.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => setCaption(s)} title="Use this caption (you can still edit it)">
            {s}
          </button>
        ))}
      </div>
      {groups.length > 0 && (
        <div className="field-row">
          <span className="control-label">Send to</span>
          <div className="filter-chips" role="radiogroup" aria-label="Send to group">
            {groups.map((g) => (
              <button
                key={g.id}
                role="radio"
                aria-checked={target?.id === g.id}
                className={target?.id === g.id ? "small pill-green" : "small"}
                onClick={() => setTo(g.id)}
                disabled={sending}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field-row">
        <button onClick={onCancel} disabled={sending}>
          {draft.kind === "note" ? "Back" : "Retake"}
        </button>
        <button className="pill-green" onClick={send} disabled={sending || !target}>
          {sending ? "Checking & sending..." : target ? `Send to ${target.name}` : "Send to group"}
        </button>
      </div>
      {!group && <p>Join or create a group first (My Group tab).</p>}
    </div>
  );
}
