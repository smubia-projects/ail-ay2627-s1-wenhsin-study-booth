import { NextResponse, type NextRequest } from "next/server";
import { getCaller, isUuid } from "@/lib/apiAuth";
import { aiConfigured, describeAiError, fullAiError, missingAiConfig } from "@/lib/ai";
import { moderatePost } from "@/lib/moderation";
import { createAdminClient, hasAdminEnv } from "@/utils/supabase/admin";

export const maxDuration = 30;

const HELD_ERROR = "We couldn't check your post right now, so it wasn't shared. Please try again in a minute.";

// POST { postId } -> { status: "approved" | "held", message }
// Moderation fails closed: any error leaves the post held, never shared.
// Red-team mode: POST { image?, text? } with header x-redteam-token returns the raw decision.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { postId?: unknown; image?: unknown; text?: unknown };

  const redteamToken = process.env.REDTEAM_TOKEN;
  if (redteamToken && request.headers.get("x-redteam-token") === redteamToken) {
    try {
      const decision = await moderatePost({
        imageBase64: typeof body.image === "string" ? body.image : undefined,
        typedText: typeof body.text === "string" ? body.text : undefined,
      });
      return NextResponse.json(decision);
    } catch (e) {
      return NextResponse.json({ allowed: false, readText: "", category: "other", reason: `error: ${describeAiError(e)}` });
    }
  }

  const { user } = await getCaller();
  if (!user) return NextResponse.json({ status: "held", message: "Please sign in again." }, { status: 401 });
  if (!isUuid(body.postId)) return NextResponse.json({ status: "held", message: "Bad request." }, { status: 400 });
  if (!hasAdminEnv) {
    return NextResponse.json({ status: "held", message: "Moderation isn't set up (missing SUPABASE_SERVICE_ROLE_KEY)." }, { status: 500 });
  }

  const admin = createAdminClient();
  const { data: post } = await admin.from("posts").select("*").eq("id", body.postId).maybeSingle();
  if (!post || post.user_id !== user.id) return NextResponse.json({ status: "held", message: "Post not found." }, { status: 404 });
  if (post.status !== "pending") {
    return NextResponse.json({ status: post.status, message: post.moderation_reason ?? "" });
  }

  const hold = async (reason: string, message = reason) => {
    await admin.from("posts").update({ status: "held", moderation_reason: reason }).eq("id", post.id);
    return NextResponse.json({ status: "held", message });
  };

  // Local development without an AI key: only when explicitly allowed, never in production.
  if (!aiConfigured()) {
    if (process.env.MODERATION_DEV_ALLOW_ALL === "true" && process.env.NODE_ENV !== "production") {
      await admin.from("posts").update({ status: "approved", moderation_reason: "dev: moderation skipped" }).eq("id", post.id);
      return NextResponse.json({ status: "approved", message: "Sent! (moderation skipped in dev)" });
    }
    return hold(`moderation error: missing ${missingAiConfig()}`, `Moderation isn't set up yet (missing ${missingAiConfig()} on the server), so your post wasn't shared.`);
  }

  try {
    const file = await admin.storage.from("posts").download(post.image_path);
    if (file.error || !file.data) return hold("image missing", HELD_ERROR);
    const imageBase64 = Buffer.from(await file.data.arrayBuffer()).toString("base64");
    const typedText = [post.note_text && `Note: ${post.note_text}`, post.caption && `Caption: ${post.caption}`]
      .filter(Boolean)
      .join("\n");

    const decision = await moderatePost({ imageBase64, typedText, timeoutMs: 20_000 });
    if (decision.allowed && decision.category === "ok") {
      await admin.from("posts").update({ status: "approved", moderation_reason: null }).eq("id", post.id);
      return NextResponse.json({ status: "approved", message: "Sent!" });
    }
    return hold(`${decision.category}: ${decision.reason}`, decision.reason);
  } catch (e) {
    const why = describeAiError(e);
    console.error(`moderation failed: ${why}`, JSON.stringify(fullAiError(e)));
    return hold(`moderation error: ${why}`, `${HELD_ERROR} (${why})`);
  }
}
