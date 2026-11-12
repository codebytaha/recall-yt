/** Armed flag. Missing or any value other than true means off. */
const RECALL_ARMED = "recallArmed";
/** Playback status written by the player. This page only reads it. */
const RECALL_STATUS = "recallStatus";

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

function requiredElement(id: string): PageNode {
  const node = page.getElementById(id);
  if (node === null) throw new Error(`Missing #${id}`);
  return node;
}
