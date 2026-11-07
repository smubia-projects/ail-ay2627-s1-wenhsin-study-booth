"use client";

import { useBooth } from "@/components/BoothProvider";
import { Avatar } from "@/components/ui";

/**
 * The group and its members. AI Lodge showcase: one seeded demo group with three friends, so there are no
 * invite codes, join, create or leave flows here (the original's are in original-supabase/ with Supabase).
 */
export default function GroupWindow() {
  const { me, group, members } = useBooth();
  if (!group) return null;
  return (
    <div className="stack">
      <p className="group-name">
        <b>{group.name}</b> <span className="hint">· demo group</span>
      </p>
      <p className="hint">
        In the full app, friends form a private, invite-only group with a 6-character code and see each other&apos;s
        posts live. This demo seeds three friends so you can try the feed, stories and scratch-to-reveal on your own.
        Your posts stay in this browser.
      </p>
      <fieldset>
        <legend>Members ({members.length})</legend>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.id}>
              <Avatar id={m.id} name={m.display_name} size={32} />
              {m.display_name}
              {m.id === me?.id ? " (you)" : ""}
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}
