// Makes one real AI call per feature through the running app and prints the
// results and any errors in full. Usage: npm run dev, then npm run ai:check
// (set BASE_URL to test a deployed app instead of http://localhost:3000).
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const env = existsSync(new URL(".env.local", root))
  ? Object.fromEntries(
      readFileSync(new URL(".env.local", root), "utf8")
        .split("\n")
        .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
    )
  : {};
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.REDTEAM_TOKEN ?? env.REDTEAM_TOKEN;
if (!TOKEN) {
  console.error("Set REDTEAM_TOKEN in .env.local (any long random string) and restart the app.");
  process.exit(1);
}
const image = `data:image/jpeg;base64,${readFileSync(new URL("redteam/images/ok-03.jpg", root)).toString("base64")}`;

const res = await fetch(`${BASE_URL}/api/ai-check`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-redteam-token": TOKEN },
  body: JSON.stringify({ image }),
}).catch((e) => {
  console.error(`Couldn't reach ${BASE_URL}: ${e.message}. Is the app running?`);
  process.exit(1);
});
const data = await res.json().catch(async () => ({ error: `HTTP ${res.status}: ${await res.text()}` }));
console.log(JSON.stringify(data, null, 2));
const failed = (data.results ?? []).filter((r) => !r.ok);
console.log(data.results ? `\n${data.results.length - failed.length}/${data.results.length} AI features working.` : "");
process.exit(data.results && failed.length === 0 ? 0 : 1);
