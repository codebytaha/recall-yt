/// <reference lib="dom" />

import type { Question, Quiz } from "../shared/types.ts";
import type { WaitSnapshot, WaitStep, WaitStepId } from "../shared/progress.ts";

/**
 * Shadow CSS for the quiz dialog. This string must match src/youtube/overlay.css.
 * The content script and the fixture adopt it inside the shadow root, so the
 * file does not need to be web-accessible.
 */
export const OVERLAY_CSS = `:host {
  all: initial;
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  color: #1C1917;
  font-family: system-ui, sans-serif;
  font-size: 16px;
  line-height: 22px;
  color-scheme: light;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.dialog {
  width: 100%;
  height: 100%;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 24px;
  overflow: auto;
  background: #F6F3EE;
  color: #1C1917;
}

.sheet {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kicker,
.progress,
.result,
.excerpt-label,
.choice,
.button,
.dismiss {
  font-family: system-ui, sans-serif;
}

.kicker,
.excerpt-label {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #57534E;
}

.prompt {
  margin: 0;
  font-family: Palatino, "Iowan Old Style", "Palatino Linotype", serif;
  font-size: 26px;
  line-height: 34px;
  font-weight: 500;
  color: #1C1917;
}

.progress {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: #57534E;
}

.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
}

.choice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  min-width: 44px;
  margin: 0;
  padding: 10px 14px;
  border: 1px solid #E7E0D6;
  border-radius: 14px;
  background: #F6F3EE;
  color: #1C1917;
  font-size: 16px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
  transition: border-color 180ms ease-out, color 180ms ease-out;
}

.choice .num {
  flex: 0 0 auto;
  min-width: 20px;
  color: #57534E;
  font-variant-numeric: tabular-nums;
}

.choice:focus-visible,
.button:focus-visible,
.dismiss:focus-visible {
  outline: 2px solid #1C1917;
  outline-offset: 2px;
}

.choice[data-mark="remembered"] {
  border-color: #1F6B4A;
  color: #1F6B4A;
}

.choice[data-mark="remembered"] .num {
  color: #1F6B4A;
}

.choice[data-mark="missed"] {
  border-color: #9A3412;
  color: #9A3412;
}

.choice[data-mark="missed"] .num {
  color: #9A3412;
}

.choice:disabled {
  cursor: default;
}

.feedback {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result {
  margin: 0;
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}

.result[data-result="correct"] {
  color: #1F6B4A;
}

.result[data-result="missed"] {
  color: #9A3412;
}

.excerpt {
  margin: 0;
  font-family: Palatino, "Iowan Old Style", "Palatino Linotype", serif;
  font-size: 18px;
  line-height: 26px;
  color: #57534E;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.button,
.dismiss {
  min-height: 44px;
  min-width: 44px;
  padding: 0 16px;
  border-radius: 14px;
  font-size: 15px;
  line-height: 20px;
  cursor: pointer;
  transition: background-color 180ms ease-out, color 180ms ease-out, border-color 180ms ease-out;
}

.button {
  border: 1px solid #1C1917;
  background: #1C1917;
  color: #F6F3EE;
}

.button.secondary {
  background: transparent;
  color: #1C1917;
}

.dismiss {
  align-self: flex-start;
  padding: 0 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #57534E;
}

.wait-title {
  margin: 0;
  font-family: Palatino, "Iowan Old Style", "Palatino Linotype", serif;
  font-size: 28px;
  line-height: 36px;
  font-weight: 500;
  color: #1C1917;
}

.steps {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: grid;
  grid-template-columns: 28px 1fr;
  column-gap: 12px;
  row-gap: 4px;
  padding: 12px 0;
  border-top: 1px solid #E7E0D6;
}

.step:first-child {
  border-top: 0;
}

.mark {
  width: 10px;
  height: 10px;
  margin-top: 6px;
  border-radius: 999px;
  background: #E7E0D6;
}

.step[data-status="done"] .mark {
  background: #1F6B4A;
}

.step[data-status="failed"] .mark {
  background: #9A3412;
}

.step[data-status="current"] .mark {
  background: #1C1917;
  animation: recall-pulse 1.2s ease-in-out infinite;
}

.step-copy {
  min-width: 0;
}

.step-title {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
  color: #1C1917;
}

.step[data-status="waiting"] .step-title,
.step[data-status="waiting"] .step-detail {
  color: #57534E;
}

.step[data-status="done"] .step-title {
  color: #1F6B4A;
}

.step[data-status="failed"] .step-title {
  color: #9A3412;
}

.step-detail {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 18px;
  color: #57534E;
}

.track {
  height: 2px;
  margin-top: 8px;
  overflow: hidden;
  background: #E7E0D6;
}

.track[hidden] {
  display: none;
}

.track > span {
  display: block;
  width: 36%;
  height: 100%;
  background: #1C1917;
  animation: recall-slide 1.4s ease-in-out infinite;
}

.wait-note {
  margin: 0;
  font-family: Palatino, "Iowan Old Style", "Palatino Linotype", serif;
  font-size: 18px;
  line-height: 26px;
  color: #1C1917;
}

.wait-note[hidden] {
  display: none;
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes recall-slide {
  from { transform: translateX(-120%); }
  to { transform: translateX(280%); }
}

@keyframes recall-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .dialog,
  .choice,
  .button,
  .dismiss,
  .mark,
  .track > span {
    transition: none;
    animation: none;
  }
}
`;

export interface MountQuizOptions {
  onAnswer: (question: Question, chosenIndex: number) => void;
  onReplay: (question: Question) => void;
  onContinue: () => void;
  onDismiss: () => void;
}

export interface MountQuizHandle {
  destroy: () => void;
}

export interface ProgressButton {
  label: string;
  secondary?: boolean;
  onClick: () => void;
}

export interface ProgressView {
  title: string;
  steps: WaitStep[];
  note: string;
  buttons: ProgressButton[];
}

export interface ProgressHandle {
  update: (view: ProgressView) => void;
  destroy: () => void;
}

interface StepNodes {
  root: HTMLLIElement;
  title: HTMLElement;
  detail: HTMLElement;
  track: HTMLElement;
}

export function viewFromWait(snapshot: WaitSnapshot, buttons: ProgressButton[]): ProgressView {
  return {
    title: snapshot.title,
    steps: snapshot.steps,
    note: snapshot.note,
    buttons,
  };
}

export function mountProgress(parent: HTMLElement, view: ProgressView): ProgressHandle {
  const host = document.createElement("div");
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("width", "100%", "important");
  host.style.setProperty("height", "100%", "important");
  const shadow = host.attachShadow({ mode: "open" });
  attachCss(shadow);
  parent.append(host);

  const dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "recall-wait-title");

  const sheet = document.createElement("div");
  sheet.className = "sheet";

  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "Recall";

  const title = document.createElement("h1");
  title.className = "wait-title";
  title.id = "recall-wait-title";

  const live = document.createElement("p");
  live.className = "sr";
  live.setAttribute("aria-live", "polite");

  const list = document.createElement("ol");
  list.className = "steps";

  const nodes = new Map<WaitStepId, StepNodes>();
  for (const item of view.steps) {
    const row = document.createElement("li");
    row.className = "step";
    row.dataset.status = item.status;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "step-copy";
    const stepTitle = document.createElement("p");
    stepTitle.className = "step-title";
    const detail = document.createElement("p");
    detail.className = "step-detail";
    const track = document.createElement("div");
    track.className = "track";
    track.setAttribute("aria-hidden", "true");
    const bar = document.createElement("span");
    track.append(bar);
    copy.append(stepTitle, detail, track);
    row.append(mark, copy);
    list.append(row);
    nodes.set(item.id, { root: row, title: stepTitle, detail, track });
  }

  const note = document.createElement("p");
  note.className = "wait-note";

  const actions = document.createElement("div");
  actions.className = "actions";

  sheet.append(kicker, title, live, list, note, actions);
  dialog.append(sheet);
  shadow.append(dialog);

  let buttonKey = "";
  let announced = "";
  let destroyed = false;

  const paint = (next: ProgressView): void => {
    if (destroyed) return;
    title.textContent = next.title;
    note.textContent = next.note;
    note.hidden = next.note === "";
    const busy = next.steps.some((item) => item.status === "current");
    dialog.setAttribute("aria-busy", busy ? "true" : "false");
    const current = next.steps.find((item) => item.status === "current" || item.status === "failed");
    if (current && current.title !== announced) {
      announced = current.title;
      live.textContent = current.title;
    }
    for (const item of next.steps) {
      const node = nodes.get(item.id);
      if (!node) continue;
      node.root.dataset.status = item.status;
      node.title.textContent = item.title;
      const showDetail = item.status !== "waiting";
      node.detail.textContent = showDetail ? item.detail : "";
      node.detail.hidden = !showDetail;
      node.track.hidden = item.status !== "current";
    }
    const key = next.buttons.map((button) => `${button.secondary ? "s" : "p"}:${button.label}`).join("|");
    if (key !== buttonKey) {
      buttonKey = key;
      actions.replaceChildren();
      for (const spec of next.buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = spec.secondary ? "button secondary" : "button";
        button.textContent = spec.label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          spec.onClick();
        });
        actions.append(button);
      }
      actions.querySelector("button")?.focus();
    }
  };

  paint(view);

  return {
    update: paint,
    destroy() {
      destroyed = true;
      host.remove();
    },
  };
}

type FocusTarget = "choice" | "replay";

/**
 * Mount one quiz dialog. The host element is only a shell; question text,
 * choices, and excerpts are written with textContent.
 */
export function mountQuiz(
  parent: HTMLElement,
  quiz: Quiz,
  options: MountQuizOptions,
): MountQuizHandle {
  const host = document.createElement("div");
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("width", "100%", "important");
  host.style.setProperty("height", "100%", "important");
  const shadow = host.attachShadow({ mode: "open" });
  attachCss(shadow);
  parent.append(host);

  let index = 0;
  let committed = false;
  let chosenIndex = -1;
  let dialog: HTMLElement | null = null;
  let destroyed = false;

  const onWindowKey = (event: KeyboardEvent): void => {
    if (destroyed || !host.isConnected) return;
    if (isEditableOutside(event, host)) return;

    const key = event.key;
    const unmodified = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (
      unmodified &&
      (key === "Escape" || key === " " || key === "k" || key === "K" || event.code === "Space")
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (key === "Tab" && unmodified) {
      const items = focusable(shadow);
      if (items.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const active = shadow.activeElement instanceof HTMLElement ? shadow.activeElement : null;
      const at = active ? items.indexOf(active) : -1;
      const next = event.shiftKey
        ? items[(at <= 0 ? items.length : at) - 1]
        : items[(at + 1) % items.length];
      next?.focus();
      return;
    }

    const choice = choiceIndexFromKey(event);
    if (choice === null || committed || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    commit(choice);
  };

  window.addEventListener("keydown", onWindowKey, true);

  const paint = (focus: FocusTarget): void => {
    const next = renderDialog(quiz, index, committed, chosenIndex, options, () => {
      const last = index >= quiz.questions.length - 1;
      if (last) {
        options.onContinue();
        return;
      }
      index += 1;
      committed = false;
      chosenIndex = -1;
      paint("choice");
    }, commit);
    if (dialog) dialog.replaceWith(next);
    else shadow.append(next);
    dialog = next;
    focusWithin(shadow, focus);
  };

  const commit = (choice: number): void => {
    if (committed || destroyed) return;
    const question = quiz.questions[index];
    if (!question || choice < 0 || choice > 3) return;
    committed = true;
    chosenIndex = choice;
    options.onAnswer(question, choice);
    paint("replay");
  };

  paint("choice");

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("keydown", onWindowKey, true);
      host.remove();
    },
  };
}

function renderDialog(
  quiz: Quiz,
  index: number,
  committed: boolean,
  chosenIndex: number,
  options: MountQuizOptions,
  advance: () => void,
  commit: (choice: number) => void,
): HTMLElement {
  const question = quiz.questions[index];
  const dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const sheet = document.createElement("div");
  sheet.className = "sheet";

  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "Recall";

  const prompt = document.createElement("h1");
  prompt.className = "prompt";
  prompt.id = "recall-question";
  prompt.textContent = question ? question.prompt : "This stop has no questions.";
  dialog.setAttribute("aria-labelledby", prompt.id);

  const progress = document.createElement("p");
  progress.className = "progress";
  const total = Math.max(quiz.questions.length, 1);
  const shown = question ? index + 1 : 0;
  progress.textContent = question
    ? `Question ${shown} of ${total}${committed ? "" : " · keys 1–4"}`
    : "Nothing to ask";

  sheet.append(kicker, prompt, progress);

  if (question) {
    const choices = document.createElement("div");
    choices.className = "choices";
    question.choices.forEach((choice, choiceIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.setAttribute("aria-keyshortcuts", String(choiceIndex + 1));
      const number = document.createElement("span");
      number.className = "num";
      number.textContent = String(choiceIndex + 1);
      const label = document.createElement("span");
      label.textContent = choice;
      button.append(number, label);
      if (committed) {
        button.disabled = true;
        if (choiceIndex === question.correctIndex) button.dataset.mark = "remembered";
        else if (choiceIndex === chosenIndex) button.dataset.mark = "missed";
      } else {
        button.addEventListener("click", () => commit(choiceIndex));
      }
      choices.append(button);
    });
    sheet.append(choices);
  }

  if (question && committed) {
    const correct = chosenIndex === question.correctIndex;
    const feedback = document.createElement("div");
    feedback.className = "feedback";

    const result = document.createElement("p");
    result.className = "result";
    result.dataset.result = correct ? "correct" : "missed";
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    result.textContent = correct ? "Correct" : "Missed";

    const excerptLabel = document.createElement("p");
    excerptLabel.className = "excerpt-label";
    excerptLabel.textContent = "From the captions";

    const excerpt = document.createElement("p");
    excerpt.className = "excerpt";
    excerpt.textContent = question.sourceExcerpt;

    const actions = document.createElement("div");
    actions.className = "actions";

    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "button secondary replay";
    replay.textContent = "Replay this moment";
    replay.addEventListener("click", () => options.onReplay(question));

    const next = document.createElement("button");
    next.type = "button";
    next.className = "button advance";
    const last = index >= quiz.questions.length - 1;
    next.textContent = last ? "Continue" : "Next";
    next.addEventListener("click", advance);

    actions.append(replay, next);
    feedback.append(result, excerptLabel, excerpt, actions);
    sheet.append(feedback);
  } else if (!question) {
    const next = document.createElement("button");
    next.type = "button";
    next.className = "button advance";
    next.textContent = "Continue";
    next.addEventListener("click", advance);
    sheet.append(next);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "dismiss";
  dismiss.textContent = "Not watching";
  dismiss.addEventListener("click", () => options.onDismiss());
  sheet.append(dismiss);
  dialog.append(sheet);
  return dialog;
}

function attachCss(shadow: ShadowRoot): void {
  if (typeof CSSStyleSheet === "function") {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(OVERLAY_CSS);
      shadow.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // A style element still keeps the dialog readable.
    }
  }
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  shadow.append(style);
}

function focusable(shadow: ShadowRoot): HTMLElement[] {
  return [...shadow.querySelectorAll<HTMLElement>("button:not([disabled])")];
}

function focusWithin(shadow: ShadowRoot, target: FocusTarget): void {
  window.requestAnimationFrame(() => {
    const selector = target === "replay" ? ".replay" : ".choice";
    const node = shadow.querySelector(selector) ?? shadow.querySelector(".advance");
    if (node instanceof HTMLElement) node.focus();
  });
}

function choiceIndexFromKey(event: KeyboardEvent): number | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "1" || event.key === "2" || event.key === "3" || event.key === "4") {
    return Number(event.key) - 1;
  }
  return null;
}

function isEditableOutside(event: KeyboardEvent, host: HTMLElement): boolean {
  if (event.composedPath().includes(host)) return false;
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  }
  return false;
}
