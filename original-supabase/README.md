# Original Supabase version (not deployed)

Chan Wen Hsin's original backend wiring: Supabase auth (sign-in, magic links, sign-out), the Next.js API routes
(`app/api/*`: moderate, caption, check-in, weekly story, session end, AI check), the session proxy, the Supabase
clients, the Anthropic-SDK AI helper and the Supabase-backed `BoothProvider`. Kept for reference.

The deployed showcase keeps everything in the browser and calls the Express API in `server/`. The schema stays in
`supabase/migrations/`. These files sit outside `app/` so Next.js does not route or deploy them, and they are
excluded from the TypeScript build and ESLint.
