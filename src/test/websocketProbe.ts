/**
 * M0a characterization probe: detect any `WebSocket` construction during a test.
 *
 * Used to prove that the local draft path opens NO socket before Share.
 * jsdom does not implement `WebSocket`, so this both records attempts and gives
 * the environment a constructor stub (a no-op that never opens a connection).
 */
export type WebSocketSpy = {
  readonly count: number;
  readonly urls: readonly string[];
  restore: () => void;
};

export function installWebSocketSpy(): WebSocketSpy {
  const g = globalThis as Record<string, unknown>;
  const original = g.WebSocket;
  const urls: string[] = [];

  class SpyWebSocket {
    constructor(url?: string | URL) {
      urls.push(String(url ?? ""));
    }
  }

  g.WebSocket = SpyWebSocket as unknown;

  return {
    get count() {
      return urls.length;
    },
    get urls() {
      return urls;
    },
    restore() {
      g.WebSocket = original;
    },
  };
}
