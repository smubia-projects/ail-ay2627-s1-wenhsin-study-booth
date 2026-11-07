// Weekly story: the AI turns SQL-computed stats into a short, positive recap.
import { z } from "zod";
import { askJson, asData } from "./ai";

export const StorySchema = z.object({
  title: z.string().max(60),
  story: z.string().max(900),
});

const SYSTEM = `You write a short, fun weekly recap for a small group of student friends who study together in Study Booth.

Use ONLY the numbers in <week_stats>. Do not invent any other facts, names, subjects or events. If a number is 0, skip it or turn it into a gentle "next week" invitation.

Style: 80-140 words, warm and playful, like a cosy story or a little newspaper bulletin, written about the group as a whole ("you all", "the group"). Positive and factual only: never compare members, never single anyone out, never shame, never judge productivity. Suitable for under-18s.`;

export async function writeStory(stats: unknown, timeoutMs: number) {
  return askJson({
    system: SYSTEM,
    content: [{ type: "text", text: `Write this week's story.\n\n${asData("week_stats", JSON.stringify(stats, null, 2))}` }],
    schema: StorySchema,
    timeoutMs,
    purpose: "text",
  });
}
