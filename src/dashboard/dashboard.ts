import { RECALL_LIBRARY_KEY, addNotebook, readLibrary, upsertLesson, youtubeId, type Lesson, type Library } from "../shared/library.ts";
import { RECALL_CARDS_KEY, dueCards, gradeCard, readCardStore, type ReviewCard, type ReviewGrade } from "../shared/review.ts";
import type { Question, VideoMemory } from "../shared/types.ts";

type Tab = "videos" | "quiz" | "short" | "cards" | "exam";

const notebooksNav = must("notebooks");
const lessonList = must("lesson-list");
const heading = must("heading");
const panel = must("panel");
const addNotebookButton = must("add-notebook") as HTMLButtonElement;
const addVideoForm = must("add-video") as HTMLFormElement;
const videoUrl = must("video-url") as HTMLInputElement;

let library: Library = readLibrary(undefined);
let memory: Record<string, VideoMemory> = {};
let cards: Record<string, ReviewCard> = {};
let notebookId = "lessons";
let videoId: string | null = null;
let tab: Tab = "videos";
let practiceAt = 0;
let examScore = 0;
let examAnswered = 0;

addNotebookButton.addEventListener("click", () => {
  const name = window.prompt("Notebook name");
  if (!name || name.trim() === "") return;
  library = addNotebook(library, name, `nb-${Date.now()}`);
  const created = library.notebooks[library.notebooks.length - 1];
  if (created) notebookId = created.id;
  void saveLibrary();
  paint();
});

addVideoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = youtubeId(videoUrl.value);
  if (!id) {
    panel.replaceChildren(note("That is not a YouTube link."));
    return;
  }
  library = upsertLesson(library, {
    videoId: id,
    title: "Untitled lesson",
    notebookId,
    updatedAt: Date.now(),
  });
  videoId = id;
  videoUrl.value = "";
  void saveLibrary();
  paint();
});

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.tab;
    if (next === "videos" || next === "quiz" || next === "short" || next === "cards" || next === "exam") {
      tab = next;
      practiceAt = 0;
      examScore = 0;
      examAnswered = 0;
      paint();
    }
  });
});

void load();

async function load(): Promise<void> {
  paint();
  const chromeApi = (globalThis as { chrome?: ChromeStorage }).chrome;
  if (!chromeApi?.storage) {
    panel.replaceChildren(note("Open this page from the Recall popup."));
    return;
  }
  const stored = await chromeApi.storage.local.get([RECALL_LIBRARY_KEY, "recallMemory", RECALL_CARDS_KEY]);
  library = readLibrary(stored[RECALL_LIBRARY_KEY]);
  memory = readMemory(stored.recallMemory);
  cards = readCardStore(stored[RECALL_CARDS_KEY]);
  notebookId = library.notebooks[0]?.id ?? "lessons";
  paint();
}

function paint(): void {
  const notebook = library.notebooks.find((item) => item.id === notebookId) ?? library.notebooks[0];
  heading.textContent = notebook?.name ?? "Lessons";
  paintNotebooks();
  paintLessons();
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.tab === tab ? "true" : "false");
  });
  if (tab === "videos") paintVideos();
  else if (tab === "quiz") paintChoice(false);
  else if (tab === "short") paintShort();
  else if (tab === "cards") paintCards();
  else paintChoice(true);
}

function paintNotebooks(): void {
  notebooksNav.replaceChildren();
  for (const notebook of library.notebooks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notebook";
    button.textContent = notebook.name;
    button.setAttribute("aria-current", notebook.id === notebookId ? "true" : "false");
    button.addEventListener("click", () => {
      notebookId = notebook.id;
      videoId = null;
      paint();
    });
    notebooksNav.append(button);
  }
}

function paintLessons(): void {
  lessonList.replaceChildren();
  for (const lesson of lessonsHere()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lesson";
    button.textContent = lesson.title;
    button.setAttribute("aria-current", lesson.videoId === videoId ? "true" : "false");
    button.addEventListener("click", () => {
      videoId = lesson.videoId;
      practiceAt = 0;
      paint();
    });
    lessonList.append(button);
  }
}

function paintVideos(): void {
  const lessons = selectedLessons();
  panel.replaceChildren();
  if (lessons.length === 0) {
    panel.append(note("No lessons here yet. Watch one with Recall, or paste a YouTube link."));
    return;
  }
  for (const lesson of lessons) {
    const row = document.createElement("div");
    row.className = "video-row";
    const copy = document.createElement("div");
    const title = document.createElement("a");
    title.href = `https://www.youtube.com/watch?v=${lesson.videoId}`;
    title.target = "_blank";
    title.rel = "noreferrer";
    title.textContent = lesson.title;
    const meta = document.createElement("p");
    meta.className = "muted";
    const record = memory[lesson.videoId];
    const quizzed = record?.checkpoints.filter((item) => item.status === "quizzed").length ?? 0;
    meta.textContent = `${quizzed} checkpoints quizzed`;
    copy.append(title, meta);
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Study";
    open.addEventListener("click", () => {
      videoId = lesson.videoId;
      tab = "quiz";
      paint();
    });
    row.append(copy, open);
    panel.append(row);
  }
}

function paintChoice(exam: boolean): void {
  const questions = questionsFor(selectedLessons());
  panel.replaceChildren();
  if (questions.length === 0) {
    panel.append(note("No questions yet. Watch the lesson with Recall and a checkpoint will save them here."));
    return;
  }
  if (exam && examAnswered >= questions.length) {
    panel.append(note(`Exam finished. ${examScore} of ${questions.length} correct.`));
    return;
  }
  const question = questions[exam ? examAnswered : practiceAt % questions.length];
  if (!question) return;
  const card = document.createElement("article");
  card.className = "card";
  const prompt = document.createElement("h2");
  prompt.className = "prompt";
  prompt.textContent = question.prompt;
  const choices = document.createElement("div");
  choices.className = "choices";
  const result = document.createElement("p");
  result.hidden = true;
  for (const [index, choice] of question.choices.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = choice;
    button.addEventListener("click", () => {
      const correct = index === question.correctIndex;
      result.hidden = false;
      result.textContent = correct ? "Correct." : question.sourceExcerpt;
      result.className = correct ? "ok" : "no";
      if (exam && !button.disabled) {
        examAnswered += 1;
        if (correct) examScore += 1;
      }
      for (const node of choices.querySelectorAll("button")) node.disabled = true;
    });
    choices.append(button);
  }
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = exam ? "Next question" : "Another question";
  next.addEventListener("click", () => {
    if (!exam) practiceAt += 1;
    paint();
  });
  card.append(prompt, choices, result, next);
  panel.append(card);
}

function paintShort(): void {
  const questions = questionsFor(selectedLessons());
  panel.replaceChildren();
  if (questions.length === 0) {
    panel.append(note("No questions yet. Watch the lesson with Recall and a checkpoint will save them here."));
    return;
  }
  const question = questions[practiceAt % questions.length];
  if (!question) return;
  const card = document.createElement("article");
  card.className = "card";
  const prompt = document.createElement("h2");
  prompt.className = "prompt";
  prompt.textContent = question.prompt;
  const field = document.createElement("textarea");
  field.placeholder = "Write the idea in your own words.";
  const reveal = document.createElement("button");
  reveal.type = "button";
  reveal.className = "primary";
  reveal.textContent = "Show the caption";
  const excerpt = document.createElement("p");
  excerpt.hidden = true;
  reveal.addEventListener("click", () => {
    excerpt.hidden = false;
    excerpt.textContent = question.sourceExcerpt;
  });
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next";
  next.addEventListener("click", () => {
    practiceAt += 1;
    paint();
  });
  card.append(prompt, field, reveal, excerpt, next);
  panel.append(card);
}

function paintCards(): void {
  const ids = new Set(selectedLessons().map((lesson) => lesson.videoId));
  const due = dueCards(Object.values(cards).filter((card) => ids.has(card.videoId)), Date.now());
  panel.replaceChildren();
  if (due.length === 0) {
    panel.append(note("No flashcards due. Finish a checkpoint and missed ideas return here."));
    return;
  }
  const cardData = due[0];
  if (!cardData) return;
  const view = document.createElement("article");
  view.className = "card";
  const count = document.createElement("p");
  count.className = "muted";
  count.textContent = `${due.length} due`;
  const prompt = document.createElement("h2");
  prompt.className = "prompt";
  prompt.textContent = cardData.prompt;
  const choices = document.createElement("div");
  choices.className = "choices";
  const grades = document.createElement("div");
  grades.className = "grades";
  grades.hidden = true;
  const result = document.createElement("p");
  result.hidden = true;
  for (const [index, choice] of cardData.choices.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = choice;
    button.addEventListener("click", () => {
      result.hidden = false;
      const correct = index === cardData.correctIndex;
      result.textContent = correct ? "Correct." : cardData.sourceExcerpt;
      result.className = correct ? "ok" : "no";
      grades.hidden = false;
      for (const node of choices.querySelectorAll("button")) node.disabled = true;
    });
    choices.append(button);
  }
  for (const grade of ["again", "good", "easy"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = grade === "again" ? "Again" : grade === "good" ? "Good" : "Easy";
    button.addEventListener("click", () => {
      void gradeAndSave(cardData, grade);
    });
    grades.append(button);
  }
  view.append(count, prompt, choices, result, grades);
  panel.append(view);
}

function questionsFor(lessons: Lesson[]): Question[] {
  const questions: Question[] = [];
  for (const lesson of lessons) {
    const record = memory[lesson.videoId];
    if (!record) continue;
    for (const quiz of record.quizzes) questions.push(...quiz.questions);
  }
  return questions;
}

function selectedLessons(): Lesson[] {
  const here = lessonsHere();
  if (!videoId) return here;
  const one = here.filter((lesson) => lesson.videoId === videoId);
  return one.length > 0 ? one : here;
}

function lessonsHere(): Lesson[] {
  return library.lessons
    .filter((lesson) => lesson.notebookId === notebookId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function note(text: string): HTMLParagraphElement {
  const node = document.createElement("p");
  node.className = "empty muted";
  node.textContent = text;
  return node;
}

async function gradeAndSave(card: ReviewCard, grade: ReviewGrade): Promise<void> {
  const chromeApi = (globalThis as { chrome?: ChromeStorage }).chrome;
  if (!chromeApi?.storage) return;
  cards[card.id] = gradeCard(card, grade, Date.now());
  await chromeApi.storage.local.set({ [RECALL_CARDS_KEY]: cards });
  paint();
}

async function saveLibrary(): Promise<void> {
  const chromeApi = (globalThis as { chrome?: ChromeStorage }).chrome;
  if (!chromeApi?.storage) return;
  await chromeApi.storage.local.set({ [RECALL_LIBRARY_KEY]: library });
}

function readMemory(value: unknown): Record<string, VideoMemory> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const store: Record<string, VideoMemory> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const memoryValue = raw as VideoMemory;
    if (!Array.isArray(memoryValue.quizzes) || !Array.isArray(memoryValue.checkpoints)) continue;
    store[id] = memoryValue;
  }
  return store;
}

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

interface ChromeStorage {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}
