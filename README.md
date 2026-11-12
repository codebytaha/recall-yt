# Quiz a YouTube lesson

Recall pauses a YouTube watch page and asks multiple-choice questions from the captions in that stretch.

## Build the extension

From this project folder, run:

```bash
npm install
npm test
npm run build
```

`npm test` exits with no failures. `npm run build` writes `dist/manifest.json`.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist` folder from this project.

The toolbar icon is Recall.

## Add the model

1. Open the Recall options page.
2. Set the interval and the number of questions. The defaults are 10 minutes and 4 questions.
3. Choose **OpenAI**, **Gemini**, or **OpenAI-compatible**.
4. Enter the model name.
5. For an OpenAI-compatible endpoint, enter the base URL. Save asks Chrome for that host only.
6. Enter the API key. The key stays in this browser.
7. Click **Save**. The page says **Saved.**
8. Click **Test key**. The page says **Key works.** or shows the error.

## Start on a lesson

1. Open a YouTube watch page that has captions.
2. Click **Quiz me every 10 min** on the player. The number matches the interval you saved.
3. Let the playhead reach the next stop. About a minute before that stop, Recall writes the quiz for the whole stretch in the background. The video keeps playing. At the stop it pauses on the questions. If that stop would pass the end of the video, the last quiz runs in the final 2 seconds instead. The popup does not show a checkpoint past the video.
4. The cover lists the work in order: **Getting the transcript**, **Calling OpenAI** (or Gemini, or the saved host), **Writing the questions**, then **Checking the questions**. The current row moves. A finished row turns green.
5. Answer the question. Press **1**, **2**, **3**, or **4**. The caption line appears after the answer.
6. Click **Continue**. The video plays again. The popup shows the last score.

## When the cover stops

If the key is missing, the calling row fails and the note says the key stays in this browser. Click **Open settings**.

If the model reply does not match the captions, Recall tries once more. If that reply also fails, click **Try again** or **Resume without this checkpoint**.

If the model does not answer within 60 seconds, the cover says so. Click **Try again** or **Resume without this checkpoint**.

If the chip says to turn captions on, click **Turn on captions**. Recall reads the caption response the player just made. It does not download a separate transcript.

A stretch with almost no speech is skipped. No quiz is requested for that stretch.
