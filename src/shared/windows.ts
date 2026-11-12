import type { Checkpoint, Cue } from "./types.ts";

/**
 * A window with fewer words than this is skipped (`too-little-speech`).
 * Forty words is enough; thirty-nine is not.
 */
export const MIN_SPEECH_WORDS = 40;

/** Last quiz fires this long before the video ends, inside the final 2 seconds. */
export const FINAL_LEAD_MS = 2_000;

/** A model call fails at this age. Shorter than this still counts as in progress. */
export const MODEL_REQUEST_MS = 60_000;

/**
 * Playback clock for one video.
 * Every timestamp is `video.currentTime` in milliseconds, never wall-clock time.
 *
 * A cue overlaps `[startMs, endMs]` when it starts before the window ends and
 * ends after the window starts. A cue that only touches an endpoint from
 * outside the window does not overlap.
 *
 * Playback that moves forward onto or past `nextStopMs` opens exactly one
 * window: `[nextStopMs - intervalMs, nextStopMs]`. The next stop becomes
 * `currentTimeMs + intervalMs`. Time that was seeked over is not folded into
 * that quiz. Playback that moves backward does not open a window, so a
 * finished stretch is not quizzed again.
 */
export interface PlaybackSample {
  videoId: string;
  cues: readonly Cue[];
  previousTimeMs: number;
  currentTimeMs: number;
  /** Start of the stretch the next quiz covers. */
  anchorMs: number;
  nextStopMs: number;
  intervalMs: number;
  /** `video.duration` in milliseconds. `0` means the length is not known yet. */
  durationMs: number;
  /** Windows already quizzed or skipped, matched on exact endpoints. */
  finished: readonly { startMs: number; endMs: number }[];
}

export interface PlaybackDecision {
  nextStopMs: number;
  anchorMs: number;
  checkpoint: Checkpoint | null;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/u).length;
}

/** Cues that overlap the playback window, in their original order. */
export function sliceCues(cues: readonly Cue[], startMs: number, endMs: number): Cue[] {
  if (!(endMs > startMs)) return [];
  return cues.filter((cue) => cue.startMs < endMs && cue.endMs > startMs);
}

export function windowWordCount(
  cues: readonly Cue[],
  startMs: number,
  endMs: number,
): number {
  const text = sliceCues(cues, startMs, endMs)
    .map((cue) => cue.text)
    .join(" ");
  return countWords(text);
}

export function knownDuration(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs > FINAL_LEAD_MS;
}

/**
 * Next quiz time after `anchorMs`.
 * An interval that would land past the video becomes the final 2 seconds.
 * Once the anchor is already inside that ending, the following stop stays
 * one interval ahead so the ending is not quizzed twice.
 */
export function scheduleStop(anchorMs: number, intervalMs: number, durationMs: number): number {
  const intervalStop = anchorMs + intervalMs;
  if (!knownDuration(durationMs)) return intervalStop;
  const finalStop = durationMs - FINAL_LEAD_MS;
  if (anchorMs >= finalStop) return intervalStop;
  return Math.min(intervalStop, finalStop);
}

/** Pull a saved stop back when it sits past the real video. */
export function reconcileStop(
  anchorMs: number,
  nextStopMs: number,
  intervalMs: number,
  durationMs: number,
): number {
  if (!knownDuration(durationMs)) return nextStopMs;
  const planned = scheduleStop(anchorMs, intervalMs, durationMs);
  const finalStop = durationMs - FINAL_LEAD_MS;
  if (nextStopMs > finalStop && planned <= finalStop) return planned;
  return nextStopMs;
}

export function resolvePlayback(sample: PlaybackSample): PlaybackDecision {
  const nextStopMs = reconcileStop(
    sample.anchorMs,
    sample.nextStopMs,
    sample.intervalMs,
    sample.durationMs,
  );
  const movedForward = sample.currentTimeMs > sample.previousTimeMs;
  const reachedStop = sample.currentTimeMs >= nextStopMs;
  if (!movedForward || !reachedStop) {
    return { nextStopMs, anchorMs: sample.anchorMs, checkpoint: null };
  }

  const endMs = nextStopMs;
  const startMs = sample.anchorMs;
  const followingStopMs = scheduleStop(sample.currentTimeMs, sample.intervalMs, sample.durationMs);
  if (!(endMs > startMs)) {
    return { nextStopMs: followingStopMs, anchorMs: sample.currentTimeMs, checkpoint: null };
  }
  const alreadyFinished = sample.finished.some(
    (window) => window.startMs === startMs && window.endMs === endMs,
  );
  if (alreadyFinished) {
    return { nextStopMs: followingStopMs, anchorMs: sample.currentTimeMs, checkpoint: null };
  }

  const words = windowWordCount(sample.cues, startMs, endMs);
  if (words < MIN_SPEECH_WORDS) {
    return {
      nextStopMs: followingStopMs,
      anchorMs: sample.currentTimeMs,
      checkpoint: {
        videoId: sample.videoId,
        startMs,
        endMs,
        status: "skipped",
        skipReason: "too-little-speech",
      },
    };
  }

  return {
    nextStopMs: followingStopMs,
    anchorMs: sample.currentTimeMs,
    checkpoint: {
      videoId: sample.videoId,
      startMs,
      endMs,
      status: "pending",
    },
  };
}
