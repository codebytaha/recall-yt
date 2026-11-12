/// <reference lib="dom" />

import { parseTimedtextJson } from "./parse-timedtext.ts";

/**
 * MAIN-world hook for document_start.
 *
 * YouTube answers a bare captionTracks[].baseUrl fetch with an empty HTTP 200
 * because that request is missing the player's proof-of-origin token. Wrap
 * fetch and XMLHttpRequest so the player's own /api/timedtext request still
 * completes, clone its body, and post JSON3 cues to the isolated world.
 *
 * CustomEvent "recall:captions" on window:
 * detail: { videoId: string, cues: { startMs: number, endMs: number, text: string }[] }
 * Detail is plain structured-cloneable data. This file never reads
 * chrome.storage and never calls a model.
 */

const HOOK_FLAG = Symbol.for("recall.timedtext-hook");
const CAPTION_EVENT = "recall:captions";

const xhrUrls = new WeakMap<XMLHttpRequest, URL>();

type CaptionDetail = {
  videoId: string;
  cues: Array<{ startMs: number; endMs: number; text: string }>;
};

function installCaptionCapture(): void {
  const host = globalThis as typeof globalThis & { [HOOK_FLAG]?: true };
  if (host[HOOK_FLAG]) return;
  host[HOOK_FLAG] = true;
  if (typeof globalThis.fetch === "function") hookFetch();
  if (typeof XMLHttpRequest === "function") hookXmlHttpRequest();
}

function hookFetch(): void {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    return nativeFetch(...args).then((response) => {
      try {
        const url = resolveUrl(fetchInputUrl(args[0]));
        if (url && isTimedtext(url) && response.ok) {
          const copy = response.clone();
          void copy.text().then(
            (body) => {
              publish(url, body);
            },
            () => {},
          );
        }
      } catch {
        // The player's response is still returned below.
      }
      return response;
    });
  }) as typeof globalThis.fetch;
}

function hookXmlHttpRequest(): void {
  const proto = XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL): void {
    const resolved = resolveUrl(url);
    if (resolved && isTimedtext(resolved)) xhrUrls.set(this, resolved);
    else xhrUrls.delete(this);
    nativeOpen.apply(this, arguments as never);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest): void {
    const url = xhrUrls.get(this);
    if (url) {
      this.addEventListener("load", () => {
        void readXhrBody(this).then(
          (body) => {
            if (body != null) publish(url, body);
          },
          () => {},
        );
      });
    }
    nativeSend.apply(this, arguments as never);
  } as typeof proto.send;
}

function fetchInputUrl(input: unknown): unknown {
  if (typeof input === "string" || input instanceof URL) return input;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return null;
}

function resolveUrl(value: unknown): URL | null {
  try {
    if (typeof value === "string") return new URL(value, location.href);
    if (value instanceof URL) return new URL(value.href);
  } catch {
    return null;
  }
  return null;
}

function isTimedtext(url: URL): boolean {
  return url.pathname === "/api/timedtext";
}

/**
 * Video id from the timedtext query (`v`), otherwise the page query (`v`).
 * The request URL itself stays out of the event so the pot token is not copied.
 */
function videoIdFor(requestUrl: URL): string {
  const fromRequest = requestUrl.searchParams.get("v");
  if (fromRequest) return fromRequest;
  try {
    return new URLSearchParams(location.search).get("v") ?? "";
  } catch {
    return "";
  }
}

function publish(requestUrl: URL, body: string): void {
  try {
    const cues = parseTimedtextJson(body);
    if (cues.length === 0) return;
    const videoId = videoIdFor(requestUrl);
    if (!videoId) return;

    const detail: CaptionDetail = structuredClone({
      videoId,
      cues: cues.map((cue) => ({
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
      })),
    });
    window.dispatchEvent(new CustomEvent<CaptionDetail>(CAPTION_EVENT, { detail }));
  } catch {
    // Caption capture must not break playback.
  }
}

function readXhrBody(xhr: XMLHttpRequest): Promise<string | null> {
  try {
    if (xhr.status < 200 || xhr.status >= 300) return Promise.resolve(null);
    switch (xhr.responseType) {
      case "":
      case "text":
        return Promise.resolve(xhr.responseText);
      case "json":
        return Promise.resolve(jsonBody(xhr.response));
      case "arraybuffer":
        return Promise.resolve(decodeBuffer(xhr.response));
      case "blob":
        return xhr.response instanceof Blob ? xhr.response.text() : Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  } catch {
    return Promise.resolve(null);
  }
}

function jsonBody(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function decodeBuffer(value: unknown): string | null {
  if (!(value instanceof ArrayBuffer)) return null;
  return new TextDecoder().decode(value);
}

installCaptionCapture();
