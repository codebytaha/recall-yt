/// <reference lib="dom" />

import type { Question, Quiz } from "../shared/types.ts";

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

@media (prefers-reduced-motion: reduce) {
  .dialog,
  .choice,
  .button,
  .dismiss {
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
