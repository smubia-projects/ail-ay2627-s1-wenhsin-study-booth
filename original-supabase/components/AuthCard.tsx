"use client";

// Sign-in is Supabase Auth only: signUp, signInWithPassword and a magic link.
// Supabase stores and checks passwords; this card only shows its answers.

import { useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

/** Supabase's default minimum password length. */
const MIN_PASSWORD = 6;

type Busy = "" | "signin" | "signup" | "magic";

/** Supabase's own error, in friendlier words where we know it; otherwise as Supabase says it. */
function friendly(error: AuthError) {
  const code = error.code ?? "";
  const msg = error.message.toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "Wrong email or password.";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered"))
    return "That email already has an account, so sign in instead.";
  if (code.includes("rate_limit") || error.status === 429 || msg.includes("rate limit")) return "Too many attempts, wait a minute.";
  return error.message;
}

/** Email + password sign-in and sign-up, with a magic link as a fallback. */
export default function AuthCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [sent, setSent] = useState(false);

  // A full page load, so the server renders with the new session cookie.
  const enter = () => window.location.replace(new URL("/", window.location.href).toString());

  function start(kind: Busy) {
    setBusy(kind);
    setError("");
    setInfo("");
  }

  function checkFields() {
    if (!email.trim()) return "Enter your email.";
    if (password.length < MIN_PASSWORD) return `Your password needs at least ${MIN_PASSWORD} characters.`;
    return "";
  }

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    const problem = checkFields();
    if (problem) return setError(problem);
    start("signin");
    const { error: err } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setError(friendly(err));
      setBusy("");
    } else enter();
  }

  async function signUp() {
    const problem = checkFields();
    if (problem) return setError(problem);
    start("signup");
    const { data, error: err } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      // Only used if "Confirm email" is ever switched on: the link lands on our callback.
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(err || !data.session ? "" : "signup");
    if (err) setError(friendly(err));
    else if (data.session) enter();
    else setInfo("Check your email to confirm your account, then sign in.");
  }

  async function magicLink() {
    if (!email.trim()) return setError("Enter your email first, and we'll send you a link.");
    start("magic");
    const { error: err } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy("");
    if (err) setError(friendly(err));
    else setSent(true);
  }

  return (
    <section className="window auth-card">
      <div className="title-bar">
        <div className="title-bar-text">Sign in or create an account</div>
      </div>
      <div className="window-body">
        {sent ? (
          <div className="stack">
            <p>
              Check your inbox for a magic link from Study Booth. Opening it signs you in (and creates your account the first time).
            </p>
            <button className="small" onClick={() => setSent(false)}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={signIn} className="stack" noValidate>
            <div className="field-row-stacked">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field-row-stacked">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                minLength={MIN_PASSWORD}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="hint">At least {MIN_PASSWORD} characters.</span>
            </div>
            <div className="auth-actions">
              <button className="pill-green" type="submit" disabled={Boolean(busy)}>
                {busy === "signin" ? "Signing in..." : "Sign in"}
              </button>
              <button className="pill-blue" type="button" onClick={signUp} disabled={Boolean(busy)}>
                {busy === "signup" ? "Creating..." : "Create account"}
              </button>
            </div>
            {error && (
              <p role="alert" className="note-held">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="note-ok">
                {info}
              </p>
            )}
            <button className="small login-magic" type="button" onClick={magicLink} disabled={Boolean(busy)}>
              {busy === "magic" ? "Sending..." : "Email me a magic link instead"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
