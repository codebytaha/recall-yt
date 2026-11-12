import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addNotebook, emptyLibrary, readLibrary, upsertLesson, youtubeId } from "../src/shared/library.ts";

describe("library", () => {
  test("reads a YouTube id from a watch link, a short link, or a bare id", () => {
    assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(youtubeId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(youtubeId("not a video"), null);
  });

  test("keeps one lesson per video and files a new notebook", () => {
    const first = upsertLesson(emptyLibrary(), {
      videoId: "dQw4w9WgXcQ",
      title: "First title",
      notebookId: "lessons",
      updatedAt: 1,
    });
    const renamed = upsertLesson(first, {
      videoId: "dQw4w9WgXcQ",
      title: "Second title",
      notebookId: "lessons",
      updatedAt: 2,
    });
    assert.equal(renamed.lessons.length, 1);
    assert.equal(renamed.lessons[0]?.title, "Second title");

    const withNotebook = addNotebook(renamed, "DSA", "dsa");
    assert.deepEqual(
      withNotebook.notebooks.map((notebook) => notebook.name),
      ["Lessons", "DSA"],
    );
    assert.equal(addNotebook(withNotebook, "   ", "empty"), withNotebook);
  });

  test("a broken store still opens on the Lessons notebook", () => {
    const library = readLibrary({ lessons: [{ videoId: "nope" }] });
    assert.equal(library.notebooks[0]?.id, "lessons");
    assert.equal(library.lessons.length, 0);
  });
});
