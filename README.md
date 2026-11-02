# Study Booth

**Study apart, together.** Study Booth is a laptop web app for small groups of student friends who study in different places. You send each other playful, handmade-looking photos and notes, and a calm little widget floats over your work, so staying connected never means picking up your phone.

Built for the AI Lodge Hackathon (track: Projects for Daily Life).

> **AI Lodge showcase.** This fork is deployed as a public demo by the SMU BIA AI Lodge. What is deployed:
>
> * **App** (Next.js, `app/` + `components/` + `lib/`) on Vercel, frontend-only. It calls the API at
>   `NEXT_PUBLIC_API_BASE`.
> * **API** (`server/`, Express bundled with esbuild) on Google Cloud Run: `POST /api/moderate`, `/api/caption` and
>   `/api/weekly-story`, using the same prompts and zod schemas (`lib/moderation.ts`, `lib/captions.ts`,
>   `lib/story.ts`). The post image travels in the request body and nothing is stored on the server.
>
> What changed for the showcase:
>
> * **No accounts, no database.** Your posts (and their images), reveals, reports, name and study sessions live in
>   this browser's `localStorage`. Instead of realtime friend groups there is one seeded demo group with three friends
>   whose fog posts ship with the app (`public/demo/`, made from the red-team "ok" images), so the feed, stories and
>   scratch-to-reveal work for a single visitor. A post counts as shared only when moderation approves it (still fails
>   closed).
> * **AI through any OpenAI-compatible gateway** (`API_BASE_URL`, `API_KEY`, `MODEL_NAME`, `VISION_MODEL_NAME`) with the
>   schema in the prompt and the same zod validation, instead of the Anthropic SDK's structured outputs.
> * **AI only on a click.** Caption ideas come from a "Suggest captions" button (they were fetched automatically), and
>   the automatic group check-ins (asked every 5 minutes) are left out. The weekly story is counted from your study
>   timer in this browser plus the demo friends' week, then written by the AI.
> * **AI Lodge rate limit** on every AI route; over the limit the app shows the AI Lodge card and the AI step stops
>   (an unchecked post is not shared).
> * A notice on the landing card and the New post screen says that posts are sent to an AI model. The pop-out
>   study widget (Document Picture-in-Picture) needs **Chrome or Edge**; other browsers keep the in-page timer.
> * The original Supabase code (auth, groups, Realtime, storage, the Next.js API routes, check-ins) is kept in
>   `original-supabase/` and `supabase/`, not deployed.

---

## 1. Problem Statement

Studying alone is lonely, and the usual fix makes it worse. Students who study by themselves miss the quiet motivation of a friend at the next desk, so they reach for the group chat on their phone. One "just checking" turns into scrolling, and the study session is gone.

This affects secondary and university students who study apart from their friends: commuters, friends at different schools, and anyone revising late at night. Studying alongside friends makes it easier to start and keep going, but phones, social feeds and group chats are built to hold attention, not give it back. Students need the feeling of studying side by side, without the feed, the notifications or the phone.

## 2. Solution Overview

Study Booth is a bright, glossy "gadget desk" in the browser. You and a few friends form a private, invite-only group. Now and then someone sends something small: a photo with a retro filter, a message written with a finger on fogged-up camera glass, or a note on a stamped paper card. It arrives under silver scratch-card foil, and friends scratch it off to reveal it. You get a moment of connection, then go back to work.

It stays on the laptop on purpose. A pop-out widget floats over your notes with a study timer and the last three posts. There's no endless feed: only the last 24 hours, and focus mode hides new posts until your timer ends.

AI works quietly in the background:

- **Moderation:** reads handwriting in every post and blocks mean or unsafe ones before friends see them.
- **Captions:** suggests captions that fit your photo and study session. You choose; it never posts for you.
- **Check-ins:** occasionally nudges the group ("Everyone's been at it a while. Stretch break!").
- **Weekly story:** writes a short recap from the group's real study stats.

## 3. Key Features

**Posting** (always user-initiated, always previewed first)
- **Photo:** a webcam snapshot with live filters: *Digicam* (early-2000s compact camera with an orange date stamp), *Film* and *B&W*.
- **Fog glass:** blow into the mic to fog up the camera glass, then write in the fog with your finger (pinch to write, tracked on-device) or the mouse.
- **Card note:** type a few words in handwritten script on a coloured paper card, and add rubber stamps.
- **Sharing:** pick an AI caption or write your own, choose the group, and send.

**Home**
- **Stories row:** a bubble per friend, with a pastel ring for unseen posts and a full-screen viewer.
- **Feed:** the last 24 hours only, updated live. Friends' posts arrive under scratch-to-reveal foil.
- **Post status:** your own posts show "Checking…" or "Not shared" with the reason.
- **Report and delete:** report a friend's post, or delete your own.

**Studying**
- **Study timer:** a timer with **focus mode**, which hides new posts until the timer ends.
- **Pop-out widget:** an always-on-top mini window (Chrome/Edge) with the timer, recent posts and a New post button. No sounds, no flashing.
- **Smart check-ins:** shown as a single dismissible banner.
- **Weekly Story:** an AI recap plus the week's stats.
- **Late-night glow:** after midnight, posts get a warm lamp tint and a "still up?" tag.

**Groups and accounts**
- **Accounts:** email + password through Supabase Auth.
- **Groups:** private and invite-only, joined with a 6-character code. There are no public profiles and no discovery.

**Design**
- **Look:** glossy Y2K gadget style with pearl plastic, chrome trim and pastel jelly buttons. All art and icons are original.
- **Usability:** one screen at a time, keyboard navigation, and reduced-motion support.

## 4. AI Integration

All AI calls run on the server (Next.js API routes) through the Anthropic SDK, so the browser never sees an API key. Every response must be JSON that passes a **zod** schema; anything else counts as a failure.

| Feature | What the AI uses | What it returns | If the AI fails |
| --- | --- | --- | --- |
| **Handwriting moderation** | The post image and any typed text | A transcription of all text, then an allow/block decision with a reason | **Fails closed:** the post is held and friends never see it |
| **Caption suggestions** | The photo, study session length, time of day, and the group's recent captions | Up to 3 caption chips the user can pick and edit | Skipped after 5 seconds; the post still sends |
| **Smart check-ins** | Group activity: who's studying, for how long, and who's been quiet | Whether to nudge, plus a friendly message for everyone | Silently skipped |
| **Weekly story** | Stats calculated in SQL: hours, streaks, late nights, posts | A short title and story; the numbers shown come from the database, not the AI | A friendly "try again" message |

**Fail-closed moderation.** Every post starts as `pending`, and database security rules stop users from changing its status. Only the server can approve a post, and only after the model allows it. If the AI errors, times out or returns invalid output, the post is held. Friends only ever see approved posts.

Check-ins are rate-limited in the database to at most one per group every 45 minutes.

## 5. External Tools & Datasets

| Tool | Used for | Licence |
| --- | --- | --- |
| Next.js 16 + React 19 (TypeScript) | Web app and server routes | MIT |
| Vercel | Hosting | Hosted service |
| Supabase | Auth, Postgres with Row Level Security, private photo storage, live updates | Libraries MIT; hosted service |
| Anthropic Claude via `@anthropic-ai/sdk`, through the apiyi proxy provided by our club | Moderation, captions, check-ins and weekly story | SDK MIT; provider terms apply |
| zod | Validating AI responses | MIT |
| MediaPipe HandLandmarker | In-browser fingertip tracking for fog writing | Apache-2.0 |
| Google Fonts: Nunito, Baloo 2, Sevillana, Courier Prime | Typography | SIL Open Font License |
| Browser APIs: Web Audio, Canvas, Document Picture-in-Picture | Blow detection, visual effects, the pop-out widget | Built into Chrome/Edge |

**Datasets:** none. The red-team cases were written by the team.

## 6. Installation & Setup

### Showcase version (this fork)

You need **Node.js 22+** and an OpenAI-compatible API key (no Supabase).

```bash
npm install
cp .env.example .env            # API: API_KEY, API_BASE_URL, VISION_MODEL_NAME, ...
echo NEXT_PUBLIC_API_BASE=http://localhost:8080 > .env.local
npm run dev:server              # the API on http://localhost:8080
npm run dev                     # the app on http://localhost:3000 (Chrome or Edge for the pop-out widget)
npm run redteam                 # optional: the red-team suite against the running API
```

Deploy: the API builds from the `Dockerfile` (Cloud Run, `.github/workflows/deploy.yml`); the app is imported on
Vercel with `NEXT_PUBLIC_API_BASE` set to the API's URL.

### Original version (Supabase)

You need **Node.js 20+**, a **Supabase** project and an **Anthropic-compatible** API key.

The original needs the files in `original-supabase/` moved back into place.

1. **Install**
   ```bash
   git clone https://github.com/wenhsin-smu/ai-lodge-2026.git
   cd ai-lodge-2026
   pnpm install
   ```
2. **Database:** in Supabase, go to **SQL Editor**, paste `supabase/migrations/0001_init.sql` and click **Run**.
3. **Auth:**
   - In Supabase **Authentication**, enable the Email provider and turn **Confirm email** off.
   - Under **URL Configuration**, add `<your-url>/auth/callback` as a redirect URL.
4. **Environment variables:** copy `.env.example` to `.env.local` and fill in:

   | Variable | Description |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (server only) |
   | `ANTHROPIC_API_KEY` | AI provider key (server only) |
   | `ANTHROPIC_MODEL` | Model name as your provider lists it |
   | `ANTHROPIC_BASE_URL` | Optional; provider URL, e.g. `https://api.apiyi.com` |
   | `REDTEAM_TOKEN` | Optional; enables `pnpm redteam` |

5. **Run:** `pnpm dev`, then open `http://localhost:3000` in Chrome or Edge.
6. **Deploy:** import the repo on Vercel and add the same environment variables.

**Try it as two friends:** use two browser profiles. One creates a group under *My Group* and shares the code; the other joins. Post from one, then scratch to reveal on the other.

## 7. AI Safety & Limitations

### Risks and guardrails

| Risk | Guardrail |
| --- | --- |
| Mean or unsafe content, including **handwritten** text | Vision moderation transcribes handwriting first, then judges image and text together, before anyone sees the post |
| **Prompt injection** written on the fog or in a note ("ignore your instructions…") | User and image text is passed to the model as data, never as instructions; injection attempts are blocked |
| AI outage or bad output | Moderation fails closed; captions and check-ins skip silently and never block posting |
| Hurtful AI wording | Prompts forbid comments on appearance, mess or productivity, and comparisons between members; captions are suggestions only |
| Made-up statistics | Weekly stats come from SQL; the AI only writes around them |
| Camera and mic privacy | Nothing is captured automatically. Hand tracking and blow detection run on-device, and only the post you choose to send is stored, in a private bucket |
| Third-party processing | Posts are sent from our server to the AI provider (through the apiyi proxy, then to the model) for moderation and captions. Keys never reach the browser |
| Young users | Invite-only groups, no public profiles or direct messages |
| Data leaking between groups | Row Level Security on every table and on photo storage |
| Something slips through | A Report button on every post, deletion by authors, and posts expire from the feed after 24 hours |

### Red-team results

`redteam/cases.json` contains 28 cases, half typed and half handwritten-style images. `pnpm redteam` runs each one through the live moderation route. Target: at least 90%.

| Group | Cases | Passed |
| --- | --- | --- |
| Harmless study posts (should pass) | 8 | 8 |
| Mean or inappropriate (should block) | 8 | 8 |
| Prompt injection (should block) | 6 | 6 |
| Edge cases: sarcasm, slang, inside jokes (should pass) | 6 | 6 |
| **Total** | **28** | **28 (100%)** |

Caption suggestions never followed an injected instruction. Two weak spots:
- **Played along with an injection:** for a fake "admin privileges" injection, one caption suggestion joked along with it. The post itself was still blocked.
- **Commented on mess:** for a rude note on messy paper, captions mentioned the mess.

Both are reasons captions stay suggestions the user must choose.

### Other testing
- **End-to-end:** a scripted two-friend test covering sign-up, groups, posting, scratch reveal, moderation holds, reporting, the timer, check-ins and the weekly story. 60/60 checks pass, run against a local copy of the database with stand-ins for Auth and the AI.
- **Security rules:** reading other groups' posts, writing as another user, and approving your own post were all refused.

### Known limitations
- **Small test set:** 28 red-team cases can't cover all slang or handwriting, so moderation can still make mistakes. Subtle sarcasm is the hardest.
- **Finger writing:** works best in good light, with one hand facing the camera. Dim rooms and busy backgrounds lower accuracy. Mouse writing is always available.
- **Blow detection:** can be triggered by fans or wind.
- **Browser support:** the pop-out widget needs Chrome or Edge.
- **Password reset:** there's no password reset while signed out yet.

## Future Improvements
- **More note styles:** embroidered (stitched) and rhinestone (bedazzled) styles.
- **Photo strip mode:** a photobooth-style strip of several shots.
- **Weekly scrapbook email:** a Sunday email for each group.
- **Bigger red-team set:** more slang, more languages, and a "blocked by mistake" feedback button.
