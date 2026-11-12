import type { Cue } from "../shared/types.ts";

/**
 * Parse a YouTube timedtext JSON3 body into cues.
 *
 * Events use `tStartMs`, `dDurationMs`, and `segs[].utf8`. Segment text is
 * joined in order. An event with no text is skipped. `endMs` is
 * `startMs + duration` (`dDurationMs`, or 0 when that field is absent).
 * XML and any other non-JSON3 body yield an empty list.
 */
export function parseTimedtextJson(body: string): Cue[] {
  const trimmed = body.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.startsWith("<")) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const events = readEvents(parsed);
  if (!events) return [];

  const cues: Cue[] = [];
  for (const event of events) {
    const cue = cueFromEvent(event);
    if (cue) cues.push(cue);
  }
  return cues;
}

function readEvents(parsed: unknown): unknown[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const events = (parsed as { events?: unknown }).events;
  return Array.isArray(events) ? events : null;
}

function cueFromEvent(event: unknown): Cue | null {
  if (!event || typeof event !== "object") return null;
  const record = event as {
    tStartMs?: unknown;
    dDurationMs?: unknown;
    segs?: unknown;
  };
  if (typeof record.tStartMs !== "number" || !Number.isFinite(record.tStartMs)) return null;

  const durationMs =
    typeof record.dDurationMs === "number" && Number.isFinite(record.dDurationMs)
      ? record.dDurationMs
      : 0;
  const text = joinSegments(record.segs);
  if (!text) return null;

  return {
    startMs: record.tStartMs,
    endMs: record.tStartMs + durationMs,
    text,
  };
}

/** Join `segs[].utf8` in order. Whitespace-only text counts as no text. */
function joinSegments(segs: unknown): string {
  if (!Array.isArray(segs)) return "";
  let text = "";
  for (const seg of segs) {
    if (!seg || typeof seg !== "object") continue;
    const utf8 = (seg as { utf8?: unknown }).utf8;
    if (typeof utf8 === "string") text += utf8;
  }
  return text.trim();
}
