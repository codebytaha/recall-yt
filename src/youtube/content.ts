/// <reference lib="dom" />

/**
 * chrome.storage.local
 *
 * recallMemory is one object keyed by video id. Each value is that video's
 * VideoMemory (checkpoints, quizzes, attempts, missed question ids, endRecapDone):
 *
 *   { [videoId: string]: VideoMemory }
 *
 * Other keys this script reads or writes:
 * - recallSettings: Settings, under RECALL_SETTINGS_KEY. Missing fields fall back to defaultSettings.
 * - recallArmed: boolean. Recall stays off until this is true.
 * - recallStatus: { videoId, nextCheckpointMs, lastScore }
 *   nextCheckpointMs is playback time in milliseconds. The popup reads this.
 *   It stays on the stop currently due until that checkpoint is resolved.
 *   lastScore is null until a quiz is finished, then { correct, total }.
 */

import { RECALL_SETTINGS_KEY, defaultSettings } from "../shared/defaults.ts";
import {
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_QUESTIONS_PER_STOP,
  MAX_INTERVAL_MINUTES,
  MAX_QUESTIONS_PER_STOP,
  MIN_INTERVAL_MINUTES,
  MIN_QUESTIONS_PER_STOP,
  emptyVideoMemory,
  type Attempt,
  type Checkpoint,
  type Cue,
  type Question,
  type Quiz,
  type VideoMemory,
} from "../shared/types.ts";
import { knownDuration, MIN_SPEECH_WORDS, MODEL_REQUEST_MS, reconcileStop, resolvePlayback, scheduleStop, shouldPrefetch, sliceCues, windowWordCount } from "../shared/windows.ts";
import {
  failWait,
  markCalling,
  markChecking,
  markRetry,
  markWriting,
  openWait,
  providerLabel,
  withElapsed,
  type WaitSnapshot,
} from "../shared/progress.ts";
import { validateQuiz } from "../shared/validate-quiz.ts";
import { mountProgress, mountQuiz, viewFromWait, type MountQuizHandle, type ProgressButton, type ProgressHandle } from "./overlay.ts";

const ARMED_KEY = "recallArmed";
const STATUS_KEY = "recallStatus";
const MEMORY_KEY = "recallMemory";

const SKIP_NOTE = "Skipped — almost no speech in that stretch.";
const MISSING_KEY_TEXT = "Recall needs a model key. It stays in this browser.";
const QUIZ_FAILED_TEXT = "The quiz didn't come back. The video stays paused.";
const CAPTIONS_TEXT = "Turn on captions and I'll quiz what was just said.";
const REPLAY_LEAD_MS = 2_000;

const INSTALLED = "__recallIsolatedContent";

type MemoryStore = Record<string, VideoMemory>;
type LiveKind = "checkpoint" | "recap";

interface LiveSettings {
  intervalMinutes: number;
  questionsPerStop: number;
  provider: "openai" | "gemini" | "openai-compatible";
  baseUrl: string;
}

interface RecallStatus {
  videoId: string;
  nextCheckpointMs: number | null;
  scheduledStopMs: number | null;
  anchorMs: number | null;
  lastScore: { correct: number; total: number } | null;
}

interface Session {
  videoId: string;
  cues: Cue[];
  previousTimeMs: number;
  nextStopMs: number;
  anchorMs: number;
  hasSavedStop: boolean;
  clockPrimed: boolean;
  memory: VideoMemory;
  lastScore: { correct: number; total: number } | null;
}

interface DueWindow {
  checkpoint: Checkpoint;
  cues: Cue[];
  questionsPerStop: number;
}

interface StorageChange {
  newValue?: unknown;
}

interface BrowserNamespace {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(listener: (changes: Record<string, StorageChange>, areaName: string) => void): void;
    };
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    openOptionsPage(): Promise<void>;
    connect?(info: { name: string }): RecallPort;
  };
}

interface MessageButton {
  label: string;
  secondary?: boolean;
  onClick: () => void;
}

interface RecallPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

const installed = globalThis as Record<string, boolean>;
if (!installed[INSTALLED]) {
  installed[INSTALLED] = true;
  void boot().catch(() => undefined);
}

let settings: LiveSettings = settingsFrom(defaultSettings);
let armed = false;
let memoryStore: MemoryStore = {};
let savedStatus: RecallStatus | null = null;
let session: Session | null = null;
let boundVideo: HTMLVideoElement | null = null;
let cover: HTMLElement | null = null;
let chipHost: HTMLElement | null = null;
let skipHost: HTMLElement | null = null;
let skipTimer = 0;
let quizHandle: MountQuizHandle | null = null;
let holdClock = false;
let generation = 0;
let due: DueWindow | null = null;
let liveKind: LiveKind = "checkpoint";
let liveQuiz: Quiz | null = null;
let liveCheckpoint: Checkpoint | null = null;
let attemptBuffer: Attempt[] = [];
let replayUntilMs: number | null = null;
let recapQueued = false;
let navToken = 0;
let cueBuffer: { videoId: string; cues: Cue[] } | null = null;
let persistQueue: Promise<void> = Promise.resolve();
let progressHandle: ProgressHandle | null = null;
let waitSnapshot: WaitSnapshot | null = null;
let waitButtons: ProgressButton[] = [];
let waitTimer = 0;
let waitStarted = 0;
let quizPort: RecallPort | null = null;

interface PreparedQuiz {
  key: string;
  due: DueWindow;
  status: "running" | "ready" | "failed";
  questions: unknown | null;
  error: string | null;
}

let prepared: PreparedQuiz | null = null;
let preparedPort: RecallPort | null = null;
let preparedReveal = false;

async function boot(): Promise<void> {
  window.addEventListener("keydown", onWindowKey, true);
  window.addEventListener("recall:captions", onCaptions);
  document.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("popstate", onNavigate);
  const api = browserOrNull();
  if (api) api.storage.onChanged.addListener(onStorage);
  await hydrate();
  await adopt();
}

async function hydrate(): Promise<void> {
  const api = browserOrNull();
  if (!api) return;
  try {
    const stored = await api.storage.local.get([RECALL_SETTINGS_KEY, ARMED_KEY, STATUS_KEY, MEMORY_KEY]);
    settings = settingsFrom(stored[RECALL_SETTINGS_KEY]);
    armed = stored[ARMED_KEY] === true;
    memoryStore = readMemoryStore(stored[MEMORY_KEY]);
    savedStatus = readStatus(stored[STATUS_KEY]);
  } catch {
    armed = false;
  }
}

async function adopt(): Promise<void> {
  const token = ++navToken;
  const videoId = currentVideoId();
  if (!videoId) {
    tearDownOverlay();
    session = null;
    unbindVideo();
    removeChip();
    return;
  }

  if (!session || session.videoId !== videoId) {
    tearDownOverlay();
    const next = createSession(videoId);
    const stored = memoryStore[videoId];
    if (stored) next.memory = stored;
    else memoryStore[videoId] = next.memory;
    applySavedStatus(next);
    if (cueBuffer?.videoId === videoId) next.cues = cueBuffer.cues;
    session = next;
  }

  const video = await waitForVideo(token);
  if (token !== navToken || !session || session.videoId !== videoId || !video) return;
  bindVideo(video);
  primeClock(video);
  renderChip();
}

function createSession(videoId: string): Session {
  return {
    videoId,
    cues: [],
    previousTimeMs: 0,
    nextStopMs: 0,
    anchorMs: 0,
    hasSavedStop: false,
    clockPrimed: false,
    memory: emptyVideoMemory(videoId),
    lastScore: null,
  };
}

function applySavedStatus(next: Session): void {
  if (!savedStatus || savedStatus.videoId !== next.videoId) return;
  const restoredStop = savedStatus.scheduledStopMs ?? savedStatus.nextCheckpointMs;
  if (restoredStop !== null && restoredStop > 0) {
    next.nextStopMs = restoredStop;
    next.hasSavedStop = true;
  }
  if (savedStatus.anchorMs !== null) {
    next.anchorMs = savedStatus.anchorMs;
  } else if (restoredStop !== null && restoredStop > 0) {
    next.anchorMs = Math.max(0, restoredStop - intervalMs());
  }
  next.lastScore = savedStatus.lastScore;
}

function primeClock(video: HTMLVideoElement): void {
  if (!session || session.clockPrimed) return;
  const now = playbackMs(video);
  const length = mediaDurationMs(video);
  session.previousTimeMs = now;
  if (!session.hasSavedStop) {
    session.anchorMs = now;
    session.nextStopMs = scheduleStop(now, intervalMs(), length);
  } else {
    session.nextStopMs = reconcileStop(session.anchorMs, session.nextStopMs, intervalMs(), length);
  }
  session.clockPrimed = true;
  persist();
}

function onNavigate(): void {
  const id = currentVideoId();
  if (!session || id !== session.videoId) {
    tearDownOverlay();
    void adopt();
    return;
  }
  if (cover && !cover.isConnected) tearDownOverlay();
  const video = findVideo();
  if (video) bindVideo(video);
  renderChip();
}

function onCaptions(event: Event): void {
  if (!(event instanceof CustomEvent)) return;
  const detail: unknown = event.detail;
  if (!isRecord(detail) || typeof detail.videoId !== "string") return;
  const urlId = currentVideoId();
  if (urlId && detail.videoId !== urlId) return;
  const cues = readCueList(detail.cues);
  cueBuffer = { videoId: detail.videoId, cues };
  if (!session || session.videoId !== detail.videoId) {
    void adopt();
    return;
  }
  session.cues = cues;
  renderChip();
}

function onStorage(changes: Record<string, StorageChange>, areaName: string): void {
  if (areaName !== "local") return;
  if (changes[RECALL_SETTINGS_KEY]) {
    const previousInterval = settings.intervalMinutes;
    settings = settingsFrom(changes[RECALL_SETTINGS_KEY].newValue);
    if (
      settings.intervalMinutes !== previousInterval &&
      armed &&
      session &&
      boundVideo &&
      !holdClock
    ) {
      const now = playbackMs(boundVideo);
      session.previousTimeMs = now;
      session.anchorMs = now;
      session.nextStopMs = scheduleStop(now, intervalMs(), mediaDurationMs(boundVideo));
      persist();
    }
    renderChip();
  }
  const armedChange = changes[ARMED_KEY];
  if (armedChange) {
    const next = armedChange.newValue === true;
    if (next !== armed) applyArmed(next, next);
  }
}

function onWindowKey(event: KeyboardEvent): void {
  if (!holdClock) return;
  if (isEditableField(event)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key;
  if (key !== " " && key !== "k" && key !== "K" && key !== "Escape" && event.code !== "Space") return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function onTimeUpdate(): void {
  const video = boundVideo;
  if (!video || !session) return;
  if (currentVideoId() !== session.videoId) {
    tearDownOverlay();
    void adopt();
    return;
  }

  const now = playbackMs(video);
  if (holdClock) {
    if (cover && !cover.isConnected) {
      tearDownOverlay();
    } else {
      if (replayUntilMs !== null && now >= replayUntilMs) {
        video.pause();
        replayUntilMs = null;
      }
      if (now >= session.nextStopMs) session.nextStopMs = now + intervalMs();
      session.previousTimeMs = now;
      return;
    }
  }

  if (!armed) {
    session.previousTimeMs = now;
    return;
  }

  const reconciled = reconcileStop(
    session.anchorMs,
    session.nextStopMs,
    intervalMs(),
    mediaDurationMs(video),
  );
  if (reconciled !== session.nextStopMs) {
    session.nextStopMs = reconciled;
    persist();
  }

  // No cues yet. Keep a single due stop on the playhead so the first quiz
  // after captions arrive is the stretch that just played. resolvePlayback
  // still decides that window; this only stops older stops from piling up.
  if (session.cues.length === 0) {
    if (now >= session.nextStopMs) session.nextStopMs = scheduleStop(now, intervalMs(), mediaDurationMs(video));
    session.previousTimeMs = now;
    return;
  }

  const previousStop = session.nextStopMs;
  const decision = resolvePlayback({
    videoId: session.videoId,
    cues: session.cues,
    previousTimeMs: session.previousTimeMs,
    currentTimeMs: now,
    nextStopMs: session.nextStopMs,
    anchorMs: session.anchorMs,
    intervalMs: intervalMs(),
    durationMs: mediaDurationMs(video),
    finished: finishedWindows(session),
  });
  session.previousTimeMs = now;
  session.anchorMs = decision.anchorMs;
  session.nextStopMs = decision.nextStopMs;

  if (!decision.checkpoint) {
    if (decision.nextStopMs !== previousStop) persist();
    maybePrefetch(now);
    return;
  }

  if (decision.checkpoint.status === "skipped") {
    upsertCheckpoint(decision.checkpoint);
    persist();
    showSkipNote();
    return;
  }

  beginQuiz(decision.checkpoint, session.cues);
}

function onEnded(): void {
  if (!session || !armed || session.memory.endRecapDone) return;
  if (missedQuestions(session.memory).length === 0) return;
  if (holdClock) {
    recapQueued = true;
    return;
  }
  showRecap();
}

function prefetchKey(videoId: string, startMs: number, endMs: number, questionsPerStop: number): string {
  return `${videoId}:${startMs}:${endMs}:${questionsPerStop}`;
}

function cuesReach(cues: readonly Cue[], endMs: number): boolean {
  let last = 0;
  for (const cue of cues) last = Math.max(last, cue.endMs);
  return last >= endMs - 2_000;
}

function maybePrefetch(nowMs: number): void {
  if (!session || holdClock || session.cues.length === 0) return;
  const startMs = session.anchorMs;
  const endMs = session.nextStopMs;
  const key = prefetchKey(session.videoId, startMs, endMs, settings.questionsPerStop);
  const readyToStart =
    shouldPrefetch(nowMs, endMs) &&
    cuesReach(session.cues, endMs) &&
    windowWordCount(session.cues, startMs, endMs) >= MIN_SPEECH_WORDS;
  if (!readyToStart) {
    if (prepared && prepared.key !== key) cancelPrefetch();
    return;
  }
  if (prepared?.key === key) return;
  cancelPrefetch();
  startPrefetch(key, startMs, endMs);
}

function startPrefetch(key: string, startMs: number, endMs: number): void {
  if (!session) return;
  const dueWindow: DueWindow = {
    checkpoint: {
      videoId: session.videoId,
      startMs,
      endMs,
      status: "pending",
    },
    cues: snapshotCues(session.cues, startMs, endMs),
    questionsPerStop: settings.questionsPerStop,
  };
  prepared = { key, due: dueWindow, status: "running", questions: null, error: null };
  preparedReveal = false;
  renderChip();
  const api = browserOrNull();
  if (!api?.runtime.connect) {
    void prefetchByMessage(dueWindow);
    return;
  }
  let port: RecallPort;
  try {
    port = api.runtime.connect({ name: "recall-quiz" });
  } catch {
    void prefetchByMessage(dueWindow);
    return;
  }
  preparedPort = port;
  let settled = false;
  port.onMessage.addListener((message) => {
    if (settled || prepared?.key !== key || !isRecord(message)) return;
    if (message.type === "result") {
      settled = true;
      finishPrefetch(key, message);
    }
  });
  port.onDisconnect.addListener(() => {
    if (settled || prepared?.key !== key) return;
    settled = true;
    finishPrefetch(key, { ok: false, error: "request-failed" });
  });
  try {
    port.postMessage({
      type: "GENERATE_QUIZ",
      videoId: dueWindow.checkpoint.videoId,
      startMs,
      endMs,
      cues: dueWindow.cues,
      questionsPerStop: dueWindow.questionsPerStop,
    });
  } catch {
    settled = true;
    void prefetchByMessage(dueWindow);
  }
}

async function prefetchByMessage(dueWindow: DueWindow): Promise<void> {
  const key = prefetchKey(
    dueWindow.checkpoint.videoId,
    dueWindow.checkpoint.startMs,
    dueWindow.checkpoint.endMs,
    dueWindow.questionsPerStop,
  );
  const api = browserOrNull();
  let response: unknown;
  try {
    if (!api) throw new Error("chrome is unavailable");
    response = await api.runtime.sendMessage({
      type: "GENERATE_QUIZ",
      videoId: dueWindow.checkpoint.videoId,
      startMs: dueWindow.checkpoint.startMs,
      endMs: dueWindow.checkpoint.endMs,
      cues: dueWindow.cues,
      questionsPerStop: dueWindow.questionsPerStop,
    });
  } catch {
    response = { ok: false, error: "request-failed" };
  }
  if (prepared?.key !== key) return;
  finishPrefetch(key, response);
}

function finishPrefetch(key: string, response: unknown): void {
  if (!prepared || prepared.key !== key) return;
  const parsed = readWorkerResult(response);
  if ("error" in parsed) {
    prepared.status = "failed";
    prepared.error = parsed.error;
  } else {
    const validated = validateQuiz({
      videoId: prepared.due.checkpoint.videoId,
      startMs: prepared.due.checkpoint.startMs,
      endMs: prepared.due.checkpoint.endMs,
      cues: prepared.due.cues,
      expectedCount: prepared.due.questionsPerStop,
      questions: parsed.questions,
    });
    if (!validated.ok) {
      prepared.status = "failed";
      prepared.error = "invalid-quiz";
    } else {
      prepared.status = "ready";
      prepared.questions = validated.quiz.questions;
    }
  }
  const port = preparedPort;
  preparedPort = null;
  try {
    port?.disconnect();
  } catch {
    // The port is already closed.
  }
  renderChip();
  if (!preparedReveal || !due || prefetchKey(due.checkpoint.videoId, due.checkpoint.startMs, due.checkpoint.endMs, due.questionsPerStop) !== key) {
    return;
  }
  preparedReveal = false;
  const result = prepared;
  prepared = null;
  if (result.status === "ready") {
    presentQuiz(due, { ok: true, quiz: { questions: result.questions } });
    return;
  }
  showWaitFailure(result.error ?? "request-failed");
}

function showPreparedWait(windowDue: DueWindow): void {
  if (!cover) return;
  const label = providerLabel(settings);
  waitSnapshot = openWait({
    providerLabel: label,
    lineCount: windowDue.cues.length,
    startMs: windowDue.checkpoint.startMs,
    endMs: windowDue.checkpoint.endMs,
  });
  waitSnapshot = markCalling(waitSnapshot, label);
  waitButtons = [notWatchingButton()];
  progressHandle?.destroy();
  progressHandle = mountProgress(cover, viewFromWait(waitSnapshot, waitButtons));
}

function cancelPrefetch(): void {
  preparedReveal = false;
  prepared = null;
  const port = preparedPort;
  preparedPort = null;
  try {
    port?.disconnect();
  } catch {
    // The port is already closed.
  }
}

function beginQuiz(checkpoint: Checkpoint, cues: readonly Cue[]): void {
  const video = boundVideo;
  const player = video ? playerFor(video) : findPlayer();
  if (!video || !player || !session) return;
  video.pause();
  holdClock = true;
  quizHandle?.destroy();
  quizHandle = null;
  attemptBuffer = [];
  ensureCover(player);
  due = {
    checkpoint,
    cues: snapshotCues(cues, checkpoint.startMs, checkpoint.endMs),
    questionsPerStop: settings.questionsPerStop,
  };
  const key = prefetchKey(checkpoint.videoId, checkpoint.startMs, checkpoint.endMs, settings.questionsPerStop);
  if (prepared?.key === key && prepared.status === "ready" && prepared.questions != null) {
    const questions = prepared.questions;
    cancelPrefetch();
    presentQuiz(due, { ok: true, quiz: { questions } });
    return;
  }
  if (prepared?.key === key && prepared.status === "running") {
    preparedReveal = true;
    showPreparedWait(due);
    return;
  }
  cancelPrefetch();
  void requestQuiz(due);
}

async function requestQuiz(windowDue: DueWindow): Promise<void> {
  const gen = ++generation;
  releaseWait();
  if (!cover) return;
  const label = providerLabel(settings);
  waitSnapshot = openWait({
    providerLabel: label,
    lineCount: windowDue.cues.length,
    startMs: windowDue.checkpoint.startMs,
    endMs: windowDue.checkpoint.endMs,
  });
  waitButtons = [notWatchingButton()];
  progressHandle = mountProgress(cover, viewFromWait(waitSnapshot, waitButtons));
  await paintFrame();
  await paintFrame();
  if (gen !== generation || !cover || !progressHandle || !waitSnapshot) return;
  waitSnapshot = markCalling(waitSnapshot, label);
  progressHandle.update(viewFromWait(waitSnapshot, waitButtons));
  waitStarted = Date.now();
  waitTimer = window.setInterval(() => {
    if (gen !== generation || !waitSnapshot || !progressHandle) return;
    const elapsed = Date.now() - waitStarted;
    if (elapsed >= MODEL_REQUEST_MS) {
      showWaitFailure("timed-out");
      return;
    }
    const seconds = Math.floor(elapsed / 1000);
    const next = withElapsed(waitSnapshot, seconds);
    if (next === waitSnapshot) return;
    waitSnapshot = next;
    progressHandle.update(viewFromWait(waitSnapshot, waitButtons));
  }, 1000);

  openQuizPort(gen, windowDue, 0);
}

function openQuizPort(gen: number, windowDue: DueWindow, attempt: number): void {
  const api = browserOrNull();
  if (!api?.runtime.connect) {
    void finishFromMessage(gen, windowDue);
    return;
  }
  let port: RecallPort;
  try {
    port = api.runtime.connect({ name: "recall-quiz" });
  } catch {
    void finishFromMessage(gen, windowDue);
    return;
  }
  quizPort = port;
  let settled = false;
  port.onMessage.addListener((message) => {
    if (settled || gen !== generation || !isRecord(message) || !waitSnapshot) return;
    if (message.type === "progress") {
      waitSnapshot = applyPhase(waitSnapshot, message);
      progressHandle?.update(viewFromWait(waitSnapshot, waitButtons));
      return;
    }
    if (message.type === "result") {
      settled = true;
      presentQuiz(windowDue, message);
    }
  });
  port.onDisconnect.addListener(() => {
    if (settled || gen !== generation) return;
    const elapsed = Date.now() - waitStarted;
    if (attempt < 1 && elapsed < MODEL_REQUEST_MS) {
      openQuizPort(gen, windowDue, attempt + 1);
      return;
    }
    settled = true;
    presentQuiz(windowDue, {
      ok: false,
      error: elapsed >= MODEL_REQUEST_MS ? "timed-out" : "request-failed",
    });
  });
  try {
    port.postMessage({
      type: "GENERATE_QUIZ",
      videoId: windowDue.checkpoint.videoId,
      startMs: windowDue.checkpoint.startMs,
      endMs: windowDue.checkpoint.endMs,
      cues: windowDue.cues,
      questionsPerStop: windowDue.questionsPerStop,
    });
  } catch {
    settled = true;
    void finishFromMessage(gen, windowDue);
  }
}

async function finishFromMessage(gen: number, windowDue: DueWindow): Promise<void> {
  const api = browserOrNull();
  let response: unknown;
  try {
    if (!api) throw new Error("chrome is unavailable");
    response = await api.runtime.sendMessage({
      type: "GENERATE_QUIZ",
      videoId: windowDue.checkpoint.videoId,
      startMs: windowDue.checkpoint.startMs,
      endMs: windowDue.checkpoint.endMs,
      cues: windowDue.cues,
      questionsPerStop: windowDue.questionsPerStop,
    });
  } catch {
    response = { error: "request-failed" };
  }
  if (gen !== generation || !session || !cover) return;
  presentQuiz(windowDue, response);
}

function applyPhase(snapshot: WaitSnapshot, message: Record<string, unknown>): WaitSnapshot {
  const label = typeof message.label === "string" && message.label !== "" ? message.label : providerLabel(settings);
  if (message.phase === "calling") return markCalling(snapshot, label);
  if (message.phase === "retrying") return markRetry(snapshot, label);
  if (message.phase === "writing") return markWriting(snapshot);
  if (message.phase === "checking") return markChecking(snapshot);
  return snapshot;
}

function notWatchingButton(): ProgressButton {
  return { label: "Not watching", secondary: true, onClick: resumeWithoutCheckpoint };
}

function paintFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function releaseWait(): void {
  window.clearInterval(waitTimer);
  waitTimer = 0;
  const port = quizPort;
  quizPort = null;
  try {
    port?.disconnect();
  } catch {
    // The port is already closed.
  }
  progressHandle?.destroy();
  progressHandle = null;
  waitSnapshot = null;
}

function presentQuiz(windowDue: DueWindow, response: unknown): void {
  if (!session) return;
  const parsed = readWorkerResult(response);
  if ("error" in parsed) {
    showWaitFailure(parsed.error);
    return;
  }

  let validated: ReturnType<typeof validateQuiz>;
  try {
    validated = validateQuiz({
      videoId: session.videoId,
      startMs: windowDue.checkpoint.startMs,
      endMs: windowDue.checkpoint.endMs,
      cues: windowDue.cues,
      expectedCount: windowDue.questionsPerStop,
      questions: parsed.questions,
    });
  } catch {
    showQuizFailure();
    return;
  }
  if (!validated.ok) {
    showWaitFailure("invalid-quiz");
    return;
  }
  releaseWait();
  mountLiveQuiz(validated.quiz, windowDue.checkpoint, "checkpoint");
}

function showQuizFailure(): void {
  showWaitFailure("request-failed");
}

function showWaitFailure(error: string): void {
  window.clearInterval(waitTimer);
  waitTimer = 0;
  generation += 1;
  const port = quizPort;
  quizPort = null;
  try {
    port?.disconnect();
  } catch {
    // The port is already closed.
  }
  const note = failureNote(error);
  const buttons: ProgressButton[] =
    error === "missing-key" || error === "missing-model" || error === "missing-base-url" || error === "bad-base-url"
      ? [
          {
            label: "Open settings",
            onClick() {
              const api = browserOrNull();
              if (!api) return;
              void api.runtime.openOptionsPage().catch(() => undefined);
            },
          },
          notWatchingButton(),
        ]
      : [
          {
            label: "Try again",
            onClick() {
              if (due) void requestQuiz(due);
            },
          },
          { label: "Resume without this checkpoint", secondary: true, onClick: resumeWithoutCheckpoint },
        ];
  if (!progressHandle || !waitSnapshot) {
    showCoverMessage(note, buttons);
    return;
  }
  const step = error === "invalid-quiz" ? "checking" : "calling";
  waitSnapshot = failWait(waitSnapshot, step, note);
  waitButtons = buttons;
  progressHandle.update(viewFromWait(waitSnapshot, waitButtons));
}

function failureNote(error: string): string {
  if (error === "missing-key") return MISSING_KEY_TEXT;
  if (error === "missing-model") return "Add a model name in settings.";
  if (error === "missing-base-url" || error === "bad-base-url") return "The saved endpoint needs a full URL.";
  if (error === "unauthorized") return "The saved key was refused.";
  if (error === "invalid-quiz") return "The reply didn't match this stretch.";
  if (error === "timed-out") return "The model did not answer within 60 seconds.";
  return QUIZ_FAILED_TEXT;
}

function mountLiveQuiz(quiz: Quiz, checkpoint: Checkpoint | null, kind: LiveKind): void {
  if (!cover) return;
  quizHandle?.destroy();
  cover.replaceChildren();
  attemptBuffer = [];
  liveKind = kind;
  liveQuiz = quiz;
  liveCheckpoint = checkpoint;
  quizHandle = mountQuiz(cover, quiz, {
    onAnswer(question, chosenIndex) {
      if (attemptBuffer.some((attempt) => attempt.questionId === question.id)) return;
      attemptBuffer.push({
        questionId: question.id,
        chosenIndex,
        correct: chosenIndex === question.correctIndex,
        atMs: boundVideo ? playbackMs(boundVideo) : 0,
      });
    },
    onReplay: replayQuestion,
    onContinue: () => finishLive("continue"),
    onDismiss: () => finishLive("dismiss"),
  });
}

function finishLive(action: "continue" | "dismiss"): void {
  const current = session;
  const quiz = liveQuiz;
  const checkpoint = liveCheckpoint;
  const kind = liveKind;
  const attempts = attemptBuffer.slice();
  const queued = recapQueued;
  if (current && action === "continue" && quiz) {
    if (kind === "checkpoint") current.memory.quizzes.push(quiz);
    current.memory.attempts.push(...attempts);
    for (const attempt of attempts) {
      if (!attempt.correct && !current.memory.missedQuestionIds.includes(attempt.questionId)) {
        current.memory.missedQuestionIds.push(attempt.questionId);
      }
    }
    current.lastScore = {
      correct: attempts.filter((attempt) => attempt.correct).length,
      total: quiz.questions.length,
    };
    if (checkpoint) upsertCheckpoint(asCheckpoint(checkpoint, "quizzed"));
  } else if (current && action === "dismiss" && checkpoint) {
    upsertCheckpoint(asCheckpoint(checkpoint, "skipped"));
  }
  closeCover();
  persist();
  resumePlayback();
  if (action === "continue" && kind === "checkpoint" && queued) showRecap();
}

function resumeWithoutCheckpoint(): void {
  if (session && due) upsertCheckpoint(asCheckpoint(due.checkpoint, "skipped"));
  const queued = recapQueued;
  closeCover();
  persist();
  resumePlayback();
  if (queued) showRecap();
}

function showRecap(): void {
  const current = session;
  if (!current || current.memory.endRecapDone || holdClock) return;
  const questions = missedQuestions(current.memory);
  if (questions.length === 0) return;
  const video = boundVideo;
  const player = video ? playerFor(video) : findPlayer();
  if (!player) return;
  if (video) video.pause();
  holdClock = true;
  ensureCover(player);
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;
  for (const question of questions) {
    startMs = Math.min(startMs, question.sourceStartMs);
    endMs = Math.max(endMs, question.sourceEndMs);
  }
  const quiz: Quiz = {
    videoId: current.videoId,
    startMs,
    endMs: endMs > startMs ? endMs : startMs + 1,
    questions,
  };
  current.memory.endRecapDone = true;
  recapQueued = false;
  persist();
  mountLiveQuiz(quiz, null, "recap");
}

function replayQuestion(question: Question): void {
  const video = boundVideo;
  if (!video) return;
  const startMs = Math.max(0, question.sourceStartMs - REPLAY_LEAD_MS);
  replayUntilMs = Math.max(startMs, question.sourceEndMs);
  video.currentTime = startMs / 1000;
  void video.play().catch(() => undefined);
}

function resumePlayback(): void {
  const video = boundVideo;
  if (!video || video.ended) return;
  void video.play().catch(() => undefined);
}

function closeCover(): void {
  generation += 1;
  releaseWait();
  quizHandle?.destroy();
  quizHandle = null;
  cover?.remove();
  cover = null;
  holdClock = false;
  replayUntilMs = null;
  due = null;
  liveQuiz = null;
  liveCheckpoint = null;
  attemptBuffer = [];
  recapQueued = false;
}

function tearDownOverlay(): void {
  cancelPrefetch();
  closeCover();
  clearSkipNote();
}

function finishedWindows(current: Session): { startMs: number; endMs: number }[] {
  return current.memory.checkpoints
    .filter((checkpoint) => checkpoint.status === "quizzed" || checkpoint.status === "skipped")
    .map((checkpoint) => ({ startMs: checkpoint.startMs, endMs: checkpoint.endMs }));
}

function upsertCheckpoint(checkpoint: Checkpoint): void {
  if (!session) return;
  const list = session.memory.checkpoints;
  const index = list.findIndex(
    (item) => item.startMs === checkpoint.startMs && item.endMs === checkpoint.endMs,
  );
  if (index === -1) list.push(checkpoint);
  else list[index] = checkpoint;
}

function asCheckpoint(checkpoint: Checkpoint, status: "quizzed" | "skipped"): Checkpoint {
  return {
    videoId: checkpoint.videoId,
    startMs: checkpoint.startMs,
    endMs: checkpoint.endMs,
    status,
  };
}

function missedQuestions(memory: VideoMemory): Question[] {
  const byId = new Map<string, Question>();
  for (const quiz of memory.quizzes) {
    for (const question of quiz.questions) byId.set(question.id, question);
  }
  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const id of memory.missedQuestionIds) {
    if (seen.has(id)) continue;
    const question = byId.get(id);
    if (!question) continue;
    seen.add(id);
    questions.push(question);
  }
  return questions;
}

function showSkipNote(): void {
  const player = findPlayer();
  if (!player) return;
  if (!skipHost || skipHost.parentElement !== player) {
    skipHost?.remove();
    skipHost = createShadowHost(NOTE_CSS, "note");
    player.append(skipHost);
  }
  const shadow = skipHost.shadowRoot;
  if (!shadow) return;
  let line = shadow.querySelector("p");
  if (!line) {
    line = document.createElement("p");
    line.setAttribute("role", "status");
    shadow.append(line);
  }
  line.textContent = SKIP_NOTE;
  window.clearTimeout(skipTimer);
  // Hides the note only. The quiz clock still comes from currentTime.
  skipTimer = window.setTimeout(() => clearSkipNote(), 4500);
}

function clearSkipNote(): void {
  window.clearTimeout(skipTimer);
  skipTimer = 0;
  skipHost?.remove();
  skipHost = null;
}

function renderChip(): void {
  const player = findPlayer();
  if (!player || !session || !currentVideoId()) {
    removeChip();
    return;
  }
  if (!chipHost || chipHost.parentElement !== player) {
    chipHost?.remove();
    chipHost = createShadowHost(CHIP_CSS, "chip");
    player.append(chipHost);
  }
  paintChip(chipHost);
}

function removeChip(): void {
  chipHost?.remove();
  chipHost = null;
}

function paintChip(host: HTMLElement): void {
  const shadow = host.shadowRoot;
  if (!shadow) return;
  const style = shadow.querySelector("style");
  shadow.replaceChildren();
  if (style) shadow.append(style);

  const chip = document.createElement("div");
  chip.className = "chip";

  if (!armed) {
    const arm = paperButton(`Quiz me every ${settings.intervalMinutes} min`, () => void setArmed(true));
    chip.append(arm);
  } else if (!session || session.cues.length === 0) {
    const line = document.createElement("p");
    line.className = "line";
    line.textContent = CAPTIONS_TEXT;
    const captions = paperButton("Turn on captions", clickSubtitles);
    const off = quietButton("Turn Recall off", () => void setArmed(false));
    chip.append(line, captions, off);
  } else {
    const interval = paperButton(`Every ${settings.intervalMinutes} min`, () => void setArmed(false));
    interval.setAttribute("aria-label", "Turn Recall off");
    chip.append(interval);
    if (prepared?.status === "running" || prepared?.status === "ready") {
      const line = document.createElement("p");
      line.className = "line";
      line.textContent = prepared.status === "ready" ? "Quiz is ready." : "Preparing the quiz.";
      chip.append(line);
    }
  }

  shadow.append(chip);
}

function paperButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "paper";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function quietButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = paperButton(label, onClick);
  button.className = "quiet";
  return button;
}

function clickSubtitles(): void {
  const button = document.querySelector("button.ytp-subtitles-button");
  if (button instanceof HTMLButtonElement) button.click();
}

function ensureCover(player: HTMLElement): HTMLElement {
  if (cover && cover.parentElement === player) return cover;
  cover?.remove();
  const next = document.createElement("div");
  next.dataset.recall = "cover";
  next.style.setProperty("all", "initial", "important");
  next.style.setProperty("position", "absolute", "important");
  next.style.setProperty("inset", "0px", "important");
  next.style.setProperty("z-index", "2147483646", "important");
  next.style.setProperty("display", "block", "important");
  next.style.setProperty("box-sizing", "border-box", "important");
  next.style.setProperty("background", "#F6F3EE", "important");
  next.style.setProperty("pointer-events", "auto", "important");
  if (getComputedStyle(player).position === "static") player.style.position = "relative";
  player.append(next);
  cover = next;
  holdClock = true;
  return next;
}

function showCoverMessage(text: string, buttons: MessageButton[]): void {
  if (!cover) return;
  quizHandle?.destroy();
  quizHandle = null;
  cover.replaceChildren();
  const host = document.createElement("div");
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("width", "100%", "important");
  host.style.setProperty("height", "100%", "important");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = MESSAGE_CSS;
  const dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Recall");
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  sheet.append(paragraph);
  const buttonEls: HTMLButtonElement[] = [];
  if (buttons.length > 0) {
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const spec of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = spec.label;
      if (spec.secondary) button.className = "secondary";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        spec.onClick();
      });
      actions.append(button);
      buttonEls.push(button);
    }
    sheet.append(actions);
  }
  dialog.append(sheet);
  shadow.append(style, dialog);
  shadow.addEventListener("keydown", (event) => trapMessageTab(event, shadow));
  cover.append(host);
  buttonEls[0]?.focus();
}

function trapMessageTab(event: KeyboardEvent, shadow: ShadowRoot): void {
  if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
  const items = [...shadow.querySelectorAll<HTMLElement>("button")];
  if (items.length === 0) return;
  event.preventDefault();
  const active = shadow.activeElement instanceof HTMLElement ? shadow.activeElement : null;
  const at = active ? items.indexOf(active) : -1;
  const next = event.shiftKey ? items[(at <= 0 ? items.length : at) - 1] : items[(at + 1) % items.length];
  next?.focus();
}

function createShadowHost(css: string, kind: "chip" | "note"): HTMLElement {
  const host = document.createElement("div");
  host.dataset.recall = kind;
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("position", "absolute", "important");
  host.style.setProperty("z-index", "70", "important");
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("width", "auto", "important");
  host.style.setProperty("height", "auto", "important");
  host.style.setProperty("pointer-events", "auto", "important");
  if (kind === "chip") {
    host.style.setProperty("top", "12px", "important");
    host.style.setProperty("left", "12px", "important");
  } else {
    host.style.setProperty("left", "12px", "important");
    host.style.setProperty("bottom", "64px", "important");
  }
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.append(style);
  return host;
}

function bindVideo(video: HTMLVideoElement): void {
  if (boundVideo === video) return;
  unbindVideo();
  boundVideo = video;
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("ended", onEnded);
  video.addEventListener("durationchange", onDuration);
  video.addEventListener("loadedmetadata", onDuration);
}

function unbindVideo(): void {
  if (!boundVideo) return;
  boundVideo.removeEventListener("timeupdate", onTimeUpdate);
  boundVideo.removeEventListener("ended", onEnded);
  boundVideo.removeEventListener("durationchange", onDuration);
  boundVideo.removeEventListener("loadedmetadata", onDuration);
  boundVideo = null;
}

function waitForVideo(token: number): Promise<HTMLVideoElement | null> {
  const existing = findVideo();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let tries = 0;
    const timer = window.setInterval(() => {
      if (token !== navToken) {
        window.clearInterval(timer);
        resolve(null);
        return;
      }
      const video = findVideo();
      tries += 1;
      if (video || tries > 20) {
        window.clearInterval(timer);
        resolve(video);
      }
    }, 150);
  });
}

function findVideo(): HTMLVideoElement | null {
  const main = document.querySelector("#movie_player video.html5-main-video");
  if (main instanceof HTMLVideoElement) return main;
  const fallback = document.querySelector("#movie_player video");
  return fallback instanceof HTMLVideoElement ? fallback : null;
}

function findPlayer(): HTMLElement | null {
  const player = document.querySelector("#movie_player");
  return player instanceof HTMLElement ? player : null;
}

function playerFor(video: HTMLVideoElement): HTMLElement | null {
  const closest = video.closest("#movie_player");
  if (closest instanceof HTMLElement) return closest;
  return findPlayer();
}

function currentVideoId(): string | null {
  if (location.pathname !== "/watch") return null;
  const id = new URLSearchParams(location.search).get("v");
  return id && id.trim() !== "" ? id : null;
}

function onDuration(): void {
  if (!session || !boundVideo || holdClock) return;
  const next = reconcileStop(
    session.anchorMs,
    session.nextStopMs,
    intervalMs(),
    mediaDurationMs(boundVideo),
  );
  if (next === session.nextStopMs) return;
  session.nextStopMs = next;
  persist();
}

function mediaDurationMs(video: HTMLVideoElement): number {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return 0;
  return Math.round(video.duration * 1000);
}

function playbackMs(video: HTMLVideoElement): number {
  if (!Number.isFinite(video.currentTime)) return 0;
  return Math.max(0, Math.round(video.currentTime * 1000));
}

function intervalMs(): number {
  return settings.intervalMinutes * 60_000;
}

function applyArmed(next: boolean, resetClock: boolean): void {
  armed = next;
  if (resetClock && next && session && boundVideo && !holdClock) {
    const now = playbackMs(boundVideo);
    session.previousTimeMs = now;
    session.anchorMs = now;
    session.nextStopMs = scheduleStop(now, intervalMs(), boundVideo ? mediaDurationMs(boundVideo) : 0);
    session.hasSavedStop = true;
    persist();
  }
  renderChip();
}

async function setArmed(next: boolean): Promise<void> {
  const resetClock = next && !armed;
  applyArmed(next, resetClock);
  const api = browserOrNull();
  if (!api) return;
  try {
    await api.storage.local.set({ [ARMED_KEY]: next });
  } catch {
    // The chip already shows the in-memory arm state.
  }
}

function persist(): void {
  if (!session) return;
  memoryStore[session.videoId] = session.memory;
  const length = boundVideo ? mediaDurationMs(boundVideo) : 0;
  const showStop = !knownDuration(length) || session.nextStopMs <= length;
  const status: RecallStatus = {
    videoId: session.videoId,
    nextCheckpointMs: showStop ? session.nextStopMs : null,
    scheduledStopMs: session.nextStopMs,
    anchorMs: session.anchorMs,
    lastScore: session.lastScore
      ? { correct: session.lastScore.correct, total: session.lastScore.total }
      : null,
  };
  savedStatus = status;
  const api = browserOrNull();
  if (!api) return;
  let memorySnapshot: MemoryStore;
  let statusSnapshot: RecallStatus;
  try {
    memorySnapshot = structuredClone(memoryStore);
    statusSnapshot = structuredClone(status);
  } catch {
    return;
  }
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(async () => {
      await api.storage.local.set({
        [MEMORY_KEY]: memorySnapshot,
        [STATUS_KEY]: statusSnapshot,
      });
    });
}

function snapshotCues(cues: readonly Cue[], startMs: number, endMs: number): Cue[] {
  return sliceCues(cues, startMs, endMs).map((cue) => ({
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
  }));
}

function readWorkerResult(value: unknown): { error: string } | { questions: unknown } {
  if (Array.isArray(value)) return { questions: value };
  if (!isRecord(value)) return { error: "request-failed" };
  if (typeof value.error === "string" && value.error !== "") return { error: value.error };
  if (value.ok === false) return { error: "request-failed" };
  if (isRecord(value.quiz) && Array.isArray(value.quiz.questions)) return { questions: value.quiz.questions };
  if (Array.isArray(value.questions)) return { questions: value.questions };
  return { error: "request-failed" };
}

function settingsFrom(value: unknown): LiveSettings {
  const record = isRecord(value) ? value : {};
  return {
    intervalMinutes: clampInt(
      record.intervalMinutes ?? defaultSettings.intervalMinutes,
      MIN_INTERVAL_MINUTES,
      MAX_INTERVAL_MINUTES,
      DEFAULT_INTERVAL_MINUTES,
    ),
    questionsPerStop: clampInt(
      record.questionsPerStop ?? defaultSettings.questionsPerStop,
      MIN_QUESTIONS_PER_STOP,
      MAX_QUESTIONS_PER_STOP,
      DEFAULT_QUESTIONS_PER_STOP,
    ),
    provider:
      record.provider === "gemini" || record.provider === "openai-compatible" ? record.provider : "openai",
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : "",
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStatus(value: unknown): RecallStatus | null {
  if (!isRecord(value) || typeof value.videoId !== "string" || value.videoId.trim() === "") return null;
  const nextCheckpointMs = finiteOrNull(value.nextCheckpointMs);
  const scheduledStopMs = finiteOrNull(value.scheduledStopMs) ?? nextCheckpointMs;
  const anchorMs = finiteOrNull(value.anchorMs);
  if (nextCheckpointMs === null && scheduledStopMs === null && anchorMs === null) return null;
  return {
    videoId: value.videoId,
    nextCheckpointMs,
    scheduledStopMs,
    anchorMs,
    lastScore: readScore(value.lastScore),
  };
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function readScore(value: unknown): { correct: number; total: number } | null {
  if (!isRecord(value)) return null;
  if (typeof value.correct !== "number" || typeof value.total !== "number") return null;
  if (!Number.isFinite(value.correct) || !Number.isFinite(value.total)) return null;
  return { correct: value.correct, total: value.total };
}

function readMemoryStore(value: unknown): MemoryStore {
  if (!isRecord(value)) return {};
  const store: MemoryStore = {};
  for (const [videoId, raw] of Object.entries(value)) {
    if (videoId.trim() === "") continue;
    store[videoId] = readMemory(videoId, raw);
  }
  return store;
}

function readMemory(videoId: string, value: unknown): VideoMemory {
  const memory = emptyVideoMemory(videoId);
  if (!isRecord(value)) return memory;
  if (Array.isArray(value.checkpoints)) {
    for (const item of value.checkpoints) {
      const checkpoint = readCheckpoint(videoId, item);
      if (checkpoint) memory.checkpoints.push(checkpoint);
    }
  }
  if (Array.isArray(value.quizzes)) {
    for (const item of value.quizzes) {
      const quiz = readQuiz(videoId, item);
      if (quiz) memory.quizzes.push(quiz);
    }
  }
  if (Array.isArray(value.attempts)) {
    for (const item of value.attempts) {
      const attempt = readAttempt(item);
      if (attempt) memory.attempts.push(attempt);
    }
  }
  if (Array.isArray(value.missedQuestionIds)) {
    for (const id of value.missedQuestionIds) {
      if (typeof id === "string" && id.trim() !== "") memory.missedQuestionIds.push(id);
    }
  }
  memory.endRecapDone = value.endRecapDone === true;
  return memory;
}

function readCheckpoint(videoId: string, value: unknown): Checkpoint | null {
  if (!isRecord(value)) return null;
  if (value.status !== "pending" && value.status !== "quizzed" && value.status !== "skipped") return null;
  if (typeof value.startMs !== "number" || typeof value.endMs !== "number") return null;
  const checkpoint: Checkpoint = {
    videoId,
    startMs: value.startMs,
    endMs: value.endMs,
    status: value.status,
  };
  if (value.skipReason === "too-little-speech") checkpoint.skipReason = "too-little-speech";
  return checkpoint;
}

function readQuiz(videoId: string, value: unknown): Quiz | null {
  if (!isRecord(value) || !Array.isArray(value.questions)) return null;
  if (typeof value.startMs !== "number" || typeof value.endMs !== "number") return null;
  const questions: Question[] = [];
  for (const item of value.questions) {
    const question = readQuestion(item);
    if (question) questions.push(question);
  }
  if (questions.length === 0) return null;
  return { videoId, startMs: value.startMs, endMs: value.endMs, questions };
}

function readQuestion(value: unknown): Question | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.trim() === "") return null;
  if (typeof value.prompt !== "string") return null;
  if (!Array.isArray(value.choices) || value.choices.length !== 4) return null;
  if (!value.choices.every((choice) => typeof choice === "string")) return null;
  if (value.correctIndex !== 0 && value.correctIndex !== 1 && value.correctIndex !== 2 && value.correctIndex !== 3) {
    return null;
  }
  if (typeof value.sourceStartMs !== "number" || typeof value.sourceEndMs !== "number") return null;
  if (typeof value.sourceExcerpt !== "string") return null;
  const choices = value.choices as [string, string, string, string];
  return {
    id: value.id,
    prompt: value.prompt,
    choices: [choices[0], choices[1], choices[2], choices[3]],
    correctIndex: value.correctIndex,
    sourceStartMs: value.sourceStartMs,
    sourceEndMs: value.sourceEndMs,
    sourceExcerpt: value.sourceExcerpt,
  };
}

function readAttempt(value: unknown): Attempt | null {
  if (!isRecord(value)) return null;
  if (typeof value.questionId !== "string" || typeof value.chosenIndex !== "number") return null;
  if (typeof value.correct !== "boolean" || typeof value.atMs !== "number") return null;
  return {
    questionId: value.questionId,
    chosenIndex: value.chosenIndex,
    correct: value.correct,
    atMs: value.atMs,
  };
}

function readCueList(value: unknown): Cue[] {
  if (!Array.isArray(value)) return [];
  const cues: Cue[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.startMs !== "number" || typeof item.endMs !== "number" || typeof item.text !== "string") {
      continue;
    }
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || !(item.endMs > item.startMs)) continue;
    cues.push({ startMs: item.startMs, endMs: item.endMs, text: item.text });
  }
  return cues;
}

function isEditableField(event: KeyboardEvent): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserOrNull(): BrowserNamespace | null {
  const chromeNamespace = (globalThis as { chrome?: BrowserNamespace }).chrome;
  if (!chromeNamespace?.storage?.local || !chromeNamespace.runtime) return null;
  return chromeNamespace;
}

const CHIP_CSS = `
:host {
  all: initial;
  display: block;
  color: #1C1917;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  line-height: 20px;
  color-scheme: light;
}
.chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  max-width: 360px;
}
.line, button {
  font-family: system-ui, sans-serif;
}
.line {
  margin: 0;
  max-width: 360px;
  padding: 12px 14px;
  border: 1px solid #E7E0D6;
  border-radius: 14px;
  background: #F6F3EE;
  color: #1C1917;
  font-size: 14px;
  line-height: 20px;
}
button {
  min-height: 44px;
  min-width: 44px;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
button.paper {
  border: 1px solid #E7E0D6;
  background: #F6F3EE;
  color: #1C1917;
}
button.quiet {
  border: 1px solid transparent;
  background: transparent;
  color: #57534E;
}
button:focus-visible {
  outline: 2px solid #1C1917;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  button { transition: none; animation: none; }
}
`;

const NOTE_CSS = `
:host {
  all: initial;
  display: block;
  color: #1C1917;
  font-family: system-ui, sans-serif;
  color-scheme: light;
}
p {
  margin: 0;
  max-width: 420px;
  padding: 12px 14px;
  border: 1px solid #E7E0D6;
  border-radius: 14px;
  background: #F6F3EE;
  color: #1C1917;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  line-height: 20px;
}
`;

const MESSAGE_CSS = `
:host {
  all: initial;
  display: block;
  width: 100%;
  height: 100%;
  color: #1C1917;
  color-scheme: light;
}
*, *::before, *::after { box-sizing: border-box; }
.dialog {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 24px;
  background: #F6F3EE;
  color: #1C1917;
}
.sheet {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
p {
  margin: 0;
  font-family: Palatino, "Iowan Old Style", "Palatino Linotype", serif;
  font-size: 26px;
  line-height: 34px;
  color: #1C1917;
}
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button {
  min-height: 44px;
  min-width: 44px;
  padding: 0 16px;
  border: 1px solid #1C1917;
  border-radius: 14px;
  background: #1C1917;
  color: #F6F3EE;
  font-family: system-ui, sans-serif;
  font-size: 15px;
  line-height: 20px;
  cursor: pointer;
}
button.secondary {
  background: transparent;
  color: #1C1917;
}
button:focus-visible {
  outline: 2px solid #1C1917;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  button, .dialog { transition: none; animation: none; }
}
`;
