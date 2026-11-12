import type { Checkpoint, Cue } from "./types.ts";

/**
 * A window with fewer words than this is skipped (`too-little-speech`).
 * Forty words is enough; thirty-nine is not.
 */
export const MIN_SPEECH_WORDS = 40;

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
  nextStopMs: number;
  intervalMs: number;
  /** Windows already quizzed or skipped, matched on exact endpoints. */
  finished: readonly { startMs: number; endMs: number }[];
}

export interface PlaybackDecision {
  nextStopMs: number;
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

export function resolvePlayback(sample: PlaybackSample): PlaybackDecision {
  const movedForward = sample.currentTimeMs > sample.previousTimeMs;
  const reachedStop = sample.currentTimeMs >= sample.nextStopMs;
  if (!movedForward || !reachedStop) {
    return { nextStopMs: sample.nextStopMs, checkpoint: null };
  }

  const endMs = sample.nextStopMs;
  const startMs = Math.max(0, sample.nextStopMs - sample.intervalMs);
  const nextStopMs = sample.currentTimeMs + sample.intervalMs;
  const alreadyFinished = sample.finished.some(
    (window) => window.startMs === startMs && window.endMs === endMs,
  );
  if (alreadyFinished) {
    return { nextStopMs, checkpoint: null };
  }

  const words = windowWordCount(sample.cues, startMs, endMs);
  if (words < MIN_SPEECH_WORDS) {
    return {
      nextStopMs,
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
    nextStopMs,
    checkpoint: {
      videoId: sample.videoId,
      startMs,
      endMs,
      status: "pending",
    },
  };
}
