"use client";

import { useState } from "react";
import { useBooth } from "@/components/BoothProvider";

export default function SettingsScreen() {
  return (
    <div className="stack">
      <section className="window card">
        <div className="window-body stack">
          <h2>Settings</h2>
          <NameSettings />
        </div>
      </section>
      <section className="window card">
        <div className="window-body stack">
          <DemoData />
        </div>
      </section>
    </div>
  );
}

function NameSettings() {
  const { me, renameMe } = useBooth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          await renameMe(name);
          setName("");
          setMessage({ ok: true, text: "Name saved." });
        } catch (err) {
          setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn't save your name." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Your name</h3>
      <p className="hint">This is what friends see on your posts and in the group.</p>
      <div className="field-row">
        <input
          aria-label="Display name"
          value={name}
          maxLength={30}
          placeholder={me?.display_name ?? ""}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="pill-green" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      {message && (
        <p role="status" className={message.ok ? "note-ok" : "note-held"}>
          {message.text}
        </p>
      )}
    </form>
  );
}

/** This demo keeps everything in the browser (no account, so no password): one button clears it. */
function DemoData() {
  const { resetDemo } = useBooth();
  const [done, setDone] = useState(false);
  return (
    <div className="stack">
      <h3>Demo data</h3>
      <p className="hint">Your posts, study sessions and name are saved only in this browser. Posts are sent to an AI model to be checked, and aren&apos;t kept on the server.</p>
      <div className="field-row">
        <button
          onClick={() => {
            resetDemo();
            setDone(true);
          }}
        >
          Clear my demo data
        </button>
      </div>
      {done && <p role="status" className="note-ok">Cleared.</p>}
    </div>
  );
}
