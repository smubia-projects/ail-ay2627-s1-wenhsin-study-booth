"use client";

// One screen at a time: a slim nav rail (a bottom tab bar on narrow windows),
// a top bar with the study timer chip and avatar menu, and the current screen
// in a centred column. The New post modal is `?new=1`.
// AI Lodge showcase: no accounts, so no sign-out (the avatar menu can reset the demo), and no automatic
// group check-ins (they asked the AI every 5 minutes without a click; see original-supabase/).

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import NewPost from "@/components/NewPost";
import { GroupIcon, HomeIcon, PlusIcon, StoryIcon, WidgetIcon } from "@/components/Icons";
import { useBooth } from "@/components/BoothProvider";
import { PipProvider, formatLeft, useSessionLeft } from "@/components/Widget";
import { Avatar, Modal } from "@/components/ui";


type Shell = {
  /** Opens the New post modal over the current screen. */
  openNewPost: () => void;
  /** A one-line status shown under the top bar (e.g. after sharing). */
  flash: (message: string, ok: boolean) => void;
};
const ShellContext = createContext<Shell>({ openNewPost: () => {}, flash: () => {} });
export const useShell = () => useContext(ShellContext);

const TABS = [
  { href: "/", label: "Home", icon: <HomeIcon size={30} /> },
  { href: "?new=1", label: "New post", icon: <PlusIcon size={30} /> },
  { href: "/study", label: "Study", icon: <WidgetIcon size={30} /> },
  { href: "/story", label: "Weekly Story", icon: <StoryIcon size={30} /> },
  { href: "/group", label: "My Group", icon: <GroupIcon size={30} /> },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <PipProvider>
      <Shell>{children}</Shell>
    </PipProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const newOpen = params.get("new") === "1";
  const { group, loading, error, selectGroup } = useBooth();
  const openedInApp = useRef(false);
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null);

  const openNewPost = useCallback(() => {
    openedInApp.current = true;
    router.push(`${pathname}?new=1`);
  }, [router, pathname]);

  const closeNewPost = useCallback(() => {
    if (openedInApp.current) router.back();
    else router.replace(pathname);
    openedInApp.current = false;
  }, [router, pathname]);

  const flash = useCallback((message: string, ok: boolean) => {
    setNotice({ message, ok });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const lateNight = useSyncExternalStore(subscribeMinute, isLateNight, () => false);

  return (
    <ShellContext.Provider value={{ openNewPost, flash }}>
      <div className={lateNight ? "app late-night" : "app"}>
        <nav className="nav-rail" aria-label="Main">
          {TABS.map((t) => {
            const isNew = t.href === "?new=1";
            const active = isNew ? newOpen : !newOpen && pathname === t.href;
            return (
              <Link
                key={t.href}
                href={isNew ? `${pathname}?new=1` : t.href}
                className={active ? "nav-item active" : "nav-item"}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (isNew) openedInApp.current = true;
                }}
                onKeyDown={moveFocusWithArrows}
              >
                {t.icon}
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-main">
          <header className="top-bar">
            <Link href="/" className="brand">
              <span className="brand-dot" aria-hidden="true" />
              Study Booth
            </Link>
            {lateNight && <span className="late-night-tag">still up? 🌙</span>}
            <div className="top-bar-right">
              <TimerChip />
              <AvatarMenu />
            </div>
          </header>

          {notice && (
            <p role="status" className={notice.ok ? "note-ok app-notice" : "note-held app-notice"}>
              {notice.message}
            </p>
          )}

          <main className="app-column">
            {error ? (
              <section className="window card">
                <div className="window-body stack">
                  <h2>Setup needed</h2>
                  <p>{error}</p>
                </div>
              </section>
            ) : loading ? (
              <p className="desktop-loading">Loading your booth…</p>
            ) : (
              children
            )}
          </main>
        </div>

        {newOpen && !loading && (
          <Modal title="New post" onClose={closeNewPost} className="modal-wide">
            <NewPost
              onShared={(ok, message, groupId) => {
                openedInApp.current = false;
                // Show the group you just posted to, with the new post at the top.
                if (groupId !== group?.id) selectGroup(groupId);
                router.replace("/");
                flash(message, ok);
              }}
            />
          </Modal>
        )}
      </div>
    </ShellContext.Provider>
  );
}

/** Up/Down (rail) and Left/Right (tab bar) move between tabs. */
function moveFocusWithArrows(e: React.KeyboardEvent<HTMLAnchorElement>) {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  const items = Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLElement>(".nav-item"));
  const i = items.indexOf(e.currentTarget);
  e.preventDefault();
  items[(i + step + items.length) % items.length].focus();
}

function TimerChip() {
  const { loading } = useBooth();
  // The session is restored from this browser, so wait until after hydration to show it.
  const live = useSessionLeft();
  const left = loading ? null : live;
  return (
    <Link href="/study" className="timer-chip" aria-label={left === null ? "Study timer" : `Study timer, ${formatLeft(left)} left`}>
      ⏱ {left === null ? "Study" : formatLeft(left)}
    </Link>
  );
}

function AvatarMenu() {
  const { me, group, resetDemo } = useBooth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = me?.display_name ?? "You";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="avatar-menu" ref={ref}>
      <button className="avatar-button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} onClick={() => setOpen((o) => !o)}>
        <Avatar id={me?.id ?? "me"} name={name} size={34} />
      </button>
      {open && (
        <div className="popover avatar-popover" role="menu">
          <div className="popover-head">
            <b>{name}</b>
            <span className="hint">{group?.name}</span>
          </div>
          <Link href="/settings" role="menuitem" className="popover-link" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <Link href="/group" role="menuitem" className="popover-link" onClick={() => setOpen(false)}>
            My Group
          </Link>
          <button
            role="menuitem"
            className="small"
            onClick={() => {
              if (window.confirm("Clear your posts, timer and name from this browser?")) resetDemo();
              setOpen(false);
            }}
          >
            Reset demo
          </button>
        </div>
      )}
    </div>
  );
}

const subscribeMinute = (onChange: () => void) => {
  const t = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(t);
};
const isLateNight = () => new Date().getHours() < 4;
