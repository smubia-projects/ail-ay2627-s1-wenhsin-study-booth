"use client";

// The demo's front door: the original landing page, with "Enter the booth" in place of the sign-in card.
// Once entered (remembered in this browser), the booth opens straight away.

import { useEffect, useState } from "react";
import { BoothProvider } from "@/components/BoothProvider";
import AppShell from "@/components/AppShell";
import Landing from "@/components/Landing";

const ENTERED_KEY = "studybooth.entered";

export default function BoothGate({ children }: { children: React.ReactNode }) {
  const [entered, setEntered] = useState<boolean | null>(null);

  useEffect(() => {
    let v = false;
    try {
      v = window.localStorage.getItem(ENTERED_KEY) === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads storage after mount
    setEntered(v);
  }, []);

  if (entered === null) return null;
  if (!entered) {
    return (
      <Landing
        notice={
          <section className="window auth-card">
            <div className="window-body stack">
              <p>
                A demo booth with three study friends. Your posts, timer and settings stay in this browser. No account
                needed.
              </p>
              <p className="hint">
                Posts you send (webcam photos, fog doodles, cards) are sent to an AI model to check them and suggest
                captions. They aren&apos;t stored on our server.
              </p>
              <button
                className="pill-green"
                onClick={() => {
                  try {
                    window.localStorage.setItem(ENTERED_KEY, "1");
                  } catch {}
                  setEntered(true);
                }}
              >
                Enter the booth
              </button>
            </div>
          </section>
        }
      />
    );
  }
  return (
    <BoothProvider>
      <AppShell>{children}</AppShell>
    </BoothProvider>
  );
}
