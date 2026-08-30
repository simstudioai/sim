// Browser-side W3C traceparent holder for the active copilot chat.
// Module-level singleton because client tool callbacks fire from deep
// inside runtime code that can't thread a React ref. The browser only
// has one active chat at a time (gated by the stop-barrier), so a
// singleton is safe.

let currentTraceparent: string | undefined

export function setCurrentChatTraceparent(value: string | undefined): void {
  currentTraceparent = value
}

// `fetch` header spread: `headers: { ...traceparentHeader(), ... }`.
export function traceparentHeader(): Record<string, string> {
  const tp = currentTraceparent
  return tp ? { traceparent: tp } : {}
}
