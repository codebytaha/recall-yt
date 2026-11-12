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

declare const chrome: {
  runtime: {
    onMessage: ChromeRuntimeOnMessage;
  };
  storage: {
    local: ChromeStorageLocal;
  };
};
