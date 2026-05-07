// GET /api/caption?q=<query>&shabads=<csv-of-ids>
//
// Streams AI captions for up to 10 shabads via Server-Sent Events. Each
// shabad gets its own `generateCaption` call fired in parallel; results
// are pushed to the stream as each promise resolves. Final event is
// {done: true}. On error the stream closes with a partial payload — the
// client transitions remaining slots to the no-explanation view.
//
// Edge runtime: Vercel Hobby's Node serverless cap is 10s, which would
// truncate a serial run of ~10 × 1.5s caption calls. Parallel fan-out
// on Edge gives 30s headroom on the same tier.
//
// Middleware gates this route with rate-limiting and CORS. The query is
// re-validated here because middleware doesn't inspect GET query strings.
//
// Error contract:
//   400 — invalid query or invalid shabads param
//   (stream is not opened on 4xx — errors are plain JSON responses)

import type { NextRequest } from "next/server";

import { validateQuery } from "@/lib/validateQuery";
import { generateCaption, type ShabadRow } from "@/lib/caption";
import { supabaseAnon } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_SHABADS = 10;

interface CaptionEvent {
  shabadId: string;
  caption: {
    explanation: string | null;
    confidence: "high" | "medium" | "low";
    guardTriggered?: string;
  };
}

interface DoneEvent {
  done: true;
}

function sseEncode(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseShabadIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  if (parts.length > MAX_SHABADS) return null;
  for (const p of parts) {
    if (!/^[0-9]+$/.test(p)) return null;
  }
  return parts;
}

async function loadShabads(ids: string[]): Promise<ShabadRow[]> {
  const sb = supabaseAnon();
  const { data, error } = await sb
    .from("shabads")
    .select(
      "shabad_id, translation_bms, ang, author, raag, transliteration",
    )
    .in("shabad_id", ids);
  if (error) {
    throw new Error(`shabads lookup failed: ${error.message}`);
  }
  return (data ?? []) as ShabadRow[];
}

export async function GET(req: NextRequest): Promise<Response> {
  const q = req.nextUrl.searchParams.get("q");
  const shabadsParam = req.nextUrl.searchParams.get("shabads");

  const validation = validateQuery(q);
  if (!validation.ok) {
    return jsonError(400, {
      error: "invalid_query",
      reason: validation.reason,
    });
  }
  const query = validation.query;

  const ids = parseShabadIds(shabadsParam);
  if (!ids) {
    return jsonError(400, {
      error: "invalid_shabads",
      message: `shabads must be a comma-separated list of 1..${MAX_SHABADS} integer IDs`,
    });
  }

  // Load shabad rows up-front (one DB call for all). If this fails we
  // return 503 BEFORE starting the stream — clients haven't opened SSE
  // yet.
  let shabads: ShabadRow[];
  try {
    shabads = await loadShabads(ids);
  } catch (e) {
    console.error("[/api/caption] shabad lookup failure:", (e as Error).message);
    return jsonError(503, { error: "service_unavailable", stage: "shabads" });
  }
  if (shabads.length === 0) {
    return jsonError(400, {
      error: "invalid_shabads",
      message: "no matching shabads",
    });
  }

  // Map ids -> shabad (preserve request order so the client can match).
  const byId = new Map<string, ShabadRow>();
  for (const s of shabads) {
    byId.set(String(s.shabad_id), s);
  }
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((s): s is ShabadRow => s !== undefined);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      // Fire all caption generations in PARALLEL. As each promise
      // resolves, push its SSE event — do NOT wait for the slowest.
      const tasks = ordered.map(async (shabad) => {
        try {
          const caption = await generateCaption(query, shabad);
          const event: CaptionEvent = {
            shabadId: String(shabad.shabad_id),
            caption: {
              explanation: caption.explanation,
              confidence: caption.confidence,
              ...(caption.explanation === null
                ? { guardTriggered: caption.guardTriggered }
                : {}),
            },
          };
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch (e) {
          // generateCaption already catches provider/guard errors into
          // Caption; a throw here means something unexpected (e.g. cache
          // or DB infra failure). Surface as a guard-triggered marker.
          console.error(
            "[/api/caption] unexpected caption error:",
            String(shabad.shabad_id),
            (e as Error).message,
          );
          const event: CaptionEvent = {
            shabadId: String(shabad.shabad_id),
            caption: {
              explanation: null,
              confidence: "low",
              guardTriggered: "provider-error",
            },
          };
          controller.enqueue(encoder.encode(sseEncode(event)));
        }
      });

      Promise.allSettled(tasks).then(() => {
        const done: DoneEvent = { done: true };
        try {
          controller.enqueue(encoder.encode(sseEncode(done)));
        } catch {
          /* stream may already be closed */
        }
        try {
          controller.close();
        } catch {
          /* idempotent close */
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // disable nginx buffering on Vercel edge
      Connection: "keep-alive",
    },
  });
}

// Block POST so probes see a clear 405.
export async function POST(): Promise<Response> {
  return jsonError(405, { error: "method_not_allowed" });
}

export const __TEST__ = { parseShabadIds, sseEncode, MAX_SHABADS };
