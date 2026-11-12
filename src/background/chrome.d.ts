/** Minimal Chrome and fetch types for the service worker. No @types package. */

interface RecallFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<RecallFetchResponse>;

interface ChromeMessageSender {
  id?: string;
}

interface ChromeRuntimeOnMessage {
  addListener(
    listener: (
      message: unknown,
      sender: ChromeMessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void,
  ): void;
}

interface ChromeStorageLocal {
  get(keys: string): Promise<Record<string, unknown>>;
}

interface ChromePort {
  name: string;
  postMessage(message: unknown): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
}

interface ChromeRuntimeOnConnect {
  addListener(listener: (port: ChromePort) => void): void;
}

declare const chrome: {
  runtime: {
    onMessage: ChromeRuntimeOnMessage;
    onConnect: ChromeRuntimeOnConnect;
    getPlatformInfo?: () => Promise<unknown>;
  };
  storage: {
    local: ChromeStorageLocal;
  };
};
