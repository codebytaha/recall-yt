export const RECALL_LIBRARY_KEY = "recallLibrary";

export interface Notebook {
  id: string;
  name: string;
}

export interface Lesson {
  videoId: string;
  title: string;
  notebookId: string;
  updatedAt: number;
}

export interface Library {
  notebooks: Notebook[];
  lessons: Lesson[];
}

export const INBOX_ID = "lessons";

export function emptyLibrary(): Library {
  return { notebooks: [{ id: INBOX_ID, name: "Lessons" }], lessons: [] };
}

export function youtubeId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/u.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return /^[\w-]{11}$/u.test(id) ? id : null;
    }
    if (url.hostname.endsWith("youtube.com")) {
      const fromQuery = url.searchParams.get("v") ?? "";
      if (/^[\w-]{11}$/u.test(fromQuery)) return fromQuery;
      const parts = url.pathname.split("/").filter(Boolean);
      const tail = parts[1] ?? "";
      return /^[\w-]{11}$/u.test(tail) ? tail : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function readLibrary(value: unknown): Library {
  const library = emptyLibrary();
  if (!value || typeof value !== "object" || Array.isArray(value)) return library;
  const raw = value as { notebooks?: unknown; lessons?: unknown };
  if (Array.isArray(raw.notebooks)) {
    const notebooks: Notebook[] = [];
    for (const item of raw.notebooks) {
      if (!item || typeof item !== "object") continue;
      const notebook = item as { id?: unknown; name?: unknown };
      if (typeof notebook.id !== "string" || typeof notebook.name !== "string") continue;
      if (notebook.id.trim() === "" || notebook.name.trim() === "") continue;
      notebooks.push({ id: notebook.id, name: notebook.name.trim() });
    }
    if (notebooks.length > 0) library.notebooks = notebooks;
  }
  if (!library.notebooks.some((notebook) => notebook.id === INBOX_ID)) {
    library.notebooks.unshift({ id: INBOX_ID, name: "Lessons" });
  }
  if (Array.isArray(raw.lessons)) {
    for (const item of raw.lessons) {
      if (!item || typeof item !== "object") continue;
      const lesson = item as { videoId?: unknown; title?: unknown; notebookId?: unknown; updatedAt?: unknown };
      if (typeof lesson.videoId !== "string" || !/^[\w-]{11}$/u.test(lesson.videoId)) continue;
      const notebookId =
        typeof lesson.notebookId === "string" && library.notebooks.some((notebook) => notebook.id === lesson.notebookId)
          ? lesson.notebookId
          : INBOX_ID;
      library.lessons.push({
        videoId: lesson.videoId,
        title: typeof lesson.title === "string" && lesson.title.trim() !== "" ? lesson.title.trim() : "Untitled lesson",
        notebookId,
        updatedAt: typeof lesson.updatedAt === "number" && Number.isFinite(lesson.updatedAt) ? lesson.updatedAt : 0,
      });
    }
  }
  return library;
}

export function upsertLesson(library: Library, lesson: Lesson): Library {
  const notebooks = library.notebooks.some((notebook) => notebook.id === lesson.notebookId)
    ? library.notebooks
    : [...library.notebooks, { id: lesson.notebookId, name: "Notebook" }];
  const lessons = library.lessons.filter((item) => item.videoId !== lesson.videoId);
  lessons.push(lesson);
  return { notebooks, lessons };
}

export function addNotebook(library: Library, name: string, id: string): Library {
  const trimmed = name.trim();
  if (trimmed === "" || library.notebooks.some((notebook) => notebook.id === id)) return library;
  return { ...library, notebooks: [...library.notebooks, { id, name: trimmed }] };
}
