import type { Settings } from "./types.ts";

export type WaitStepId = "transcript" | "calling" | "writing" | "checking";

export type WaitStepStatus = "waiting" | "current" | "done" | "failed";

export interface WaitStep {
  id: WaitStepId;
  title: string;
  detail: string;
  status: WaitStepStatus;
}

export interface WaitSnapshot {
  title: string;
  steps: WaitStep[];
  note: string;
}

const ORDER: WaitStepId[] = ["transcript", "calling", "writing", "checking"];

export function providerLabel(settings: Pick<Settings, "provider" | "baseUrl"> & { name?: string }): string {
  const named = settings.name?.trim() ?? "";
  if (named !== "") return named;
  if (settings.provider === "gemini") return "Gemini";
  if (settings.provider === "openai") return "OpenAI";
  try {
    const host = new URL(settings.baseUrl).host;
    return host === "" ? "the saved endpoint" : host;
  } catch {
    return "the saved endpoint";
  }
}

export function stretchTitle(startMs: number, endMs: number): string {
  return `${clock(startMs)} to ${clock(endMs)}`;
}

export function openWait(input: {
  providerLabel: string;
  lineCount: number;
  startMs: number;
  endMs: number;
}): WaitSnapshot {
  const lines = input.lineCount === 1 ? "1 line" : `${input.lineCount} lines`;
  return {
    title: stretchTitle(input.startMs, input.endMs),
    note: "",
    steps: [
      step("transcript", "Getting the transcript", `${lines} from this stretch`, "current"),
      step("calling", `Calling ${input.providerLabel}`, "Waiting for the reply", "waiting"),
      step("writing", "Writing the questions", "Reading the reply", "waiting"),
      step("checking", "Checking the questions", "Matching each question to the transcript", "waiting"),
    ],
  };
}

export function markCalling(snapshot: WaitSnapshot, label: string): WaitSnapshot {
  return retitle(move(snapshot, "calling"), "calling", `Calling ${label}`, "Waiting for the reply");
}

export function markWriting(snapshot: WaitSnapshot): WaitSnapshot {
  return move(snapshot, "writing");
}

export function markChecking(snapshot: WaitSnapshot): WaitSnapshot {
  return move(snapshot, "checking");
}

export function markRetry(snapshot: WaitSnapshot, label: string): WaitSnapshot {
  const next = markCalling(snapshot, label);
  return {
    ...next,
    note: "That reply didn't match the captions. Trying again.",
  };
}

export function withElapsed(snapshot: WaitSnapshot, seconds: number): WaitSnapshot {
  if (seconds < 1) return snapshot;
  const unit = seconds === 1 ? "second" : "seconds";
  return {
    ...snapshot,
    steps: snapshot.steps.map((item) => {
      if (item.id !== "calling" || item.status !== "current") return item;
      return { ...item, detail: `Waiting for the reply, ${seconds} ${unit}` };
    }),
  };
}

export function failWait(snapshot: WaitSnapshot, id: WaitStepId, note: string): WaitSnapshot {
  const at = ORDER.indexOf(id);
  return {
    ...snapshot,
    note,
    steps: snapshot.steps.map((item) => {
      const index = ORDER.indexOf(item.id);
      if (index < at) return { ...item, status: "done" };
      if (item.id === id) return { ...item, status: "failed" };
      return { ...item, status: "waiting" };
    }),
  };
}

function move(snapshot: WaitSnapshot, current: WaitStepId): WaitSnapshot {
  const at = ORDER.indexOf(current);
  return {
    ...snapshot,
    note: "",
    steps: snapshot.steps.map((item) => {
      const index = ORDER.indexOf(item.id);
      const status: WaitStepStatus = index < at ? "done" : index === at ? "current" : "waiting";
      return { ...item, status };
    }),
  };
}

function retitle(snapshot: WaitSnapshot, id: WaitStepId, title: string, detail: string): WaitSnapshot {
  return {
    ...snapshot,
    steps: snapshot.steps.map((item) => (item.id === id ? { ...item, title, detail } : item)),
  };
}

function step(id: WaitStepId, title: string, detail: string, status: WaitStepStatus): WaitStep {
  return { id, title, detail, status };
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
