import { RECALL_CARDS_KEY, dueCards, gradeCard, readCardStore, type ReviewCard, type ReviewGrade } from "../shared/review.ts";

/** Armed flag. Missing or any value other than true means off. */
const RECALL_ARMED = "recallArmed";
/** Playback status written by the player. This page only reads it. */
const RECALL_STATUS = "recallStatus";

import { RECALL_CARDS_KEY, dueCards, gradeCard, readCardStore, type ReviewCard, type ReviewGrade } from "../shared/review.ts";

interface LastScore {
  correct: number;
  total: number;
}

interface RecallStatus {
  videoId: string | null;
  nextCheckpointMs: number | null;
  lastScore: LastScore | null;
}

interface PageClassList {
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
}

interface PageNode {
  textContent: string | null;
  hidden: boolean;
  checked: boolean;
  classList: PageClassList;
  addEventListener(type: string, listener: () => void): void;
}

interface PageDocument {
  getElementById(id: string): PageNode | null;
}

const page = (globalThis as unknown as { document: PageDocument }).document;

interface StorageChange {
  newValue?: unknown;
}

interface ChromeLike {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(
        listener: (changes: Record<string, StorageChange>, areaName: string) => void,
      ): void;
    };
  };
  runtime: {
    openOptionsPage(): Promise<void>;
    getURL(path: string): string;
  };
}

const chrome = (globalThis as unknown as { chrome: ChromeLike }).chrome;

const armedInput = requiredElement("armed");
const armCopy = requiredElement("arm-copy");
const checkpoint = requiredElement("checkpoint");
const score = requiredElement("score");
const empty = requiredElement("empty");
const settingsButton = requiredElement("settings");

let storageEpoch = 0;

armedInput.addEventListener("change", () => {
  storageEpoch += 1;
  const epoch = storageEpoch;
  const next = armedInput.checked;
  renderArmed(next);
  void chrome.storage.local.set({ [RECALL_ARMED]: next }).catch(() => {
    if (epoch !== storageEpoch) return;
    renderArmed(!next);
    armCopy.textContent = "Could not save that.";
  });
});

settingsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

const dashboardButton = requiredElement("dashboard");
dashboardButton.addEventListener("click", () => {
  const tabsApi = (chrome as ChromeLike & { tabs?: { create(options: { url: string }): Promise<unknown> } }).tabs;
  const url = chrome.runtime.getURL("dashboard.html");
  if (tabsApi) void tabsApi.create({ url });
  else window.open(url);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  storageEpoch += 1;
  if (Object.prototype.hasOwnProperty.call(changes, RECALL_ARMED)) {
    renderArmed(changes[RECALL_ARMED]?.newValue === true);
  }
  if (Object.prototype.hasOwnProperty.call(changes, RECALL_STATUS)) {
    renderStatus(readStatus(changes[RECALL_STATUS]?.newValue));
  }
});

void loadPopup();

async function loadPopup(): Promise<void> {
  const seen = storageEpoch;
  try {
    const stored = await chrome.storage.local.get([RECALL_ARMED, RECALL_STATUS]);
    if (seen !== storageEpoch) return;
    renderArmed(stored[RECALL_ARMED] === true);
    renderStatus(readStatus(stored[RECALL_STATUS]));
  } catch {
    if (seen !== storageEpoch) return;
    renderArmed(false);
    renderStatus(readStatus(undefined));
    armCopy.textContent = "Could not read Recall.";
  }
}

function renderArmed(on: boolean): void {
  armedInput.checked = on;
  armCopy.textContent = on ? "On." : "Off until you turn it on.";
}

function renderStatus(status: RecallStatus): void {
  const hasCheckpoint = status.nextCheckpointMs !== null;
  const hasScore = status.lastScore !== null;
  checkpoint.hidden = !hasCheckpoint;
  score.hidden = !hasScore;
  empty.hidden = hasCheckpoint || hasScore;

  if (status.nextCheckpointMs !== null) {
    checkpoint.textContent = formatCheckpoint(status.nextCheckpointMs);
  } else {
    checkpoint.textContent = "";
  }

  score.classList.remove("remembered", "missed");
  if (status.lastScore !== null) {
    score.textContent = `Last score ${status.lastScore.correct}/${status.lastScore.total}`;
    if (status.lastScore.total > 0 && status.lastScore.correct === status.lastScore.total) {
      score.classList.add("remembered");
    } else if (status.lastScore.total > 0 && status.lastScore.correct === 0) {
      score.classList.add("missed");
    }
  } else {
    score.textContent = "";
  }
}

function readStatus(value: unknown): RecallStatus {
  const emptyStatus: RecallStatus = {
    videoId: null,
    nextCheckpointMs: null,
    lastScore: null,
  };
  if (value === null || typeof value !== "object") return emptyStatus;
  const raw = value as Record<string, unknown>;
  return {
    videoId: typeof raw.videoId === "string" ? raw.videoId : null,
    nextCheckpointMs: finiteNumber(raw.nextCheckpointMs),
    lastScore: readScore(raw.lastScore),
  };
}

function readScore(value: unknown): LastScore | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const correct = finiteNumber(raw.correct);
  const total = finiteNumber(raw.total);
  if (correct === null || total === null) return null;
  return { correct, total };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function formatCheckpoint(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondText = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `Next checkpoint ${hours}:${String(minutes).padStart(2, "0")}:${secondText}`;
  }
  return `Next checkpoint ${minutes}:${secondText}`;
}

interface Stop {
  startMs: number;
  endMs: number;
}

const reviewDom = (globalThis as unknown as { document: Document }).document;
const prevButton = reviewDom.getElementById("prev");
const nextButton = reviewDom.getElementById("next");
const stopsSelect = reviewDom.getElementById("stops");
const moveNote = reviewDom.getElementById("move-note");
const reviewCount = reviewDom.getElementById("review-count");
const reviewPrompt = reviewDom.getElementById("review-prompt");
const reviewChoices = reviewDom.getElementById("review-choices");
const reviewResult = reviewDom.getElementById("review-result");
const reviewExcerpt = reviewDom.getElementById("review-excerpt");
const reviewGrades = reviewDom.getElementById("review-grades");

let due: ReviewCard[] = [];
let cardIndex = 0;
let answered = false;

prevButton?.addEventListener("click", () => {
  void moveStop(-1);
});
nextButton?.addEventListener("click", () => {
  void moveStop(1);
});
stopsSelect?.addEventListener("change", () => {
  if (!(stopsSelect instanceof HTMLSelectElement)) return;
  const ms = Number(stopsSelect.value);
  if (!Number.isFinite(ms)) return;
  void seekTo(ms);
});
reviewDom.getElementById("again")?.addEventListener("click", () => {
  void grade("again");
});
reviewDom.getElementById("good")?.addEventListener("click", () => {
  void grade("good");
});
reviewDom.getElementById("easy")?.addEventListener("click", () => {
  void grade("easy");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (Object.prototype.hasOwnProperty.call(changes, "recallCards")) void loadReview();
});

void loadReview();
void loadStops();

async function loadStops(): Promise<void> {
  const stops = await askStops();
  if (!(stopsSelect instanceof HTMLSelectElement)) return;
  stopsSelect.replaceChildren();
  if (!stops || stops.stops.length === 0) {
    const option = reviewDom.createElement("option");
    option.value = "";
    option.textContent = "No checkpoints yet";
    stopsSelect.append(option);
    stopsSelect.disabled = true;
    return;
  }
  stopsSelect.disabled = false;
  for (const stop of stops.stops) {
    const option = reviewDom.createElement("option");
    option.value = String(stop.startMs);
    option.textContent = `${clock(stop.startMs)} to ${clock(stop.endMs)}`;
    stopsSelect.append(option);
  }
  const nearest = nearestStop(stops.stops, stops.currentMs);
  if (nearest) stopsSelect.value = String(nearest.startMs);
}

async function moveStop(direction: -1 | 1): Promise<void> {
  const stops = await askStops();
  if (!stops || stops.stops.length === 0) {
    showMoveNote("No checkpoints yet.");
    return;
  }
  const ordered = stops.stops.slice().sort((left, right) => left.startMs - right.startMs);
  const current = nearestStop(ordered, stops.currentMs);
  const index = current ? ordered.findIndex((stop) => stop.startMs === current.startMs) : 0;
  const next = ordered[index + direction];
  if (!next) {
    showMoveNote(direction < 0 ? "This is the first checkpoint." : "This is the last checkpoint.");
    return;
  }
  await seekTo(next.startMs);
  if (stopsSelect instanceof HTMLSelectElement) stopsSelect.value = String(next.startMs);
  showMoveNote("");
}

async function seekTo(ms: number): Promise<void> {
  const tabsApi = (chrome as ChromeLike & { tabs?: TabsLike }).tabs;
  if (!tabsApi) {
    showMoveNote("Open the lesson tab.");
    return;
  }
  const tabs = await tabsApi.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) {
    showMoveNote("Open the lesson tab.");
    return;
  }
  try {
    const response = await tabsApi.sendMessage(tabId, { type: "SEEK_TO", ms });
    if (!response || (response as { ok?: boolean }).ok !== true) showMoveNote("Open a YouTube lesson.");
    else showMoveNote("");
  } catch {
    showMoveNote("Open a YouTube lesson.");
  }
}

async function askStops(): Promise<{ currentMs: number; stops: Stop[] } | null> {
  const tabsApi = (chrome as ChromeLike & { tabs?: TabsLike }).tabs;
  if (!tabsApi) return null;
  const tabs = await tabsApi.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) return null;
  try {
    const response = await tabsApi.sendMessage(tabId, { type: "LIST_STOPS" });
    if (!response || typeof response !== "object") return null;
    const raw = response as { stops?: unknown; currentMs?: unknown };
    if (!Array.isArray(raw.stops)) return null;
    const stops: Stop[] = [];
    for (const item of raw.stops) {
      if (!item || typeof item !== "object") continue;
      const stop = item as { startMs?: unknown; endMs?: unknown };
      if (typeof stop.startMs !== "number" || typeof stop.endMs !== "number") continue;
      stops.push({ startMs: stop.startMs, endMs: stop.endMs });
    }
    return { currentMs: typeof raw.currentMs === "number" ? raw.currentMs : 0, stops };
  } catch {
    return null;
  }
}

function nearestStop(stops: Stop[], currentMs: number): Stop | null {
  let best: Stop | null = null;
  for (const stop of stops) {
    if (stop.startMs <= currentMs + 1500) best = stop;
  }
  return best ?? stops[0] ?? null;
}

function showMoveNote(text: string): void {
  if (!(moveNote instanceof HTMLElement)) return;
  moveNote.hidden = text === "";
  moveNote.textContent = text;
}

async function loadReview(): Promise<void> {
  const stored = await chrome.storage.local.get([RECALL_CARDS_KEY]);
  due = dueCards(Object.values(readCardStore(stored[RECALL_CARDS_KEY])), Date.now());
  cardIndex = 0;
  answered = false;
  paintCard();
}

function paintCard(): void {
  const card = due[cardIndex];
  if (!(reviewCount instanceof HTMLElement) || !(reviewPrompt instanceof HTMLElement)) return;
  if (!(reviewChoices instanceof HTMLElement) || !(reviewGrades instanceof HTMLElement)) return;
  if (!(reviewResult instanceof HTMLElement) || !(reviewExcerpt instanceof HTMLElement)) return;
  reviewResult.hidden = true;
  reviewExcerpt.hidden = true;
  reviewGrades.hidden = true;
  reviewChoices.replaceChildren();
  if (!card) {
    reviewCount.textContent = "No cards due.";
    reviewPrompt.hidden = true;
    return;
  }
  reviewCount.textContent = `${cardIndex + 1} of ${due.length} due`;
  reviewPrompt.hidden = false;
  reviewPrompt.textContent = card.prompt;
  card.choices.forEach((choice, index) => {
    const button = reviewDom.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => reveal(card, index));
    reviewChoices.append(button);
  });
}

function reveal(card: ReviewCard, index: number): void {
  if (answered) return;
  answered = true;
  if (!(reviewResult instanceof HTMLElement) || !(reviewExcerpt instanceof HTMLElement)) return;
  if (!(reviewGrades instanceof HTMLElement) || !(reviewChoices instanceof HTMLElement)) return;
  const correct = index === card.correctIndex;
  reviewResult.hidden = false;
  reviewResult.textContent = correct ? "Correct." : "Missed.";
  reviewResult.classList.toggle("remembered", correct);
  reviewResult.classList.toggle("missed", !correct);
  reviewExcerpt.hidden = false;
  reviewExcerpt.textContent = card.sourceExcerpt;
  reviewGrades.hidden = false;
  for (const button of reviewChoices.querySelectorAll("button")) {
    button.disabled = true;
  }
}

async function grade(name: ReviewGrade): Promise<void> {
  const card = due[cardIndex];
  if (!card || !answered) return;
  const stored = await chrome.storage.local.get([RECALL_CARDS_KEY]);
  const store = readCardStore(stored[RECALL_CARDS_KEY]);
  const current = store[card.id];
  if (!current) return;
  store[card.id] = gradeCard(current, name, Date.now());
  await chrome.storage.local.set({ [RECALL_CARDS_KEY]: store });
  due.splice(cardIndex, 1);
  if (cardIndex >= due.length) cardIndex = 0;
  answered = false;
  paintCard();
}

function clock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface TabsLike {
  query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

function requiredElement(id: string): PageNode {
  const node = page.getElementById(id);
  if (node === null) throw new Error(`Missing #${id}`);
  return node;
}
