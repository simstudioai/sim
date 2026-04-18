/**
 * Browser-side mutable holder for the W3C `traceparent` of the
 * current copilot chat stream.
 *
 * Why this exists as a module-level singleton rather than React
 * state / ref: the client-tool-execution code path fires off HTTP
 * callbacks (`/api/copilot/confirm`) from arbitrary depth inside
 * tool runners that aren't children of any React component tree —
 * some are triggered from workflow-runtime callbacks, iframed
 * editors, or generic promise chains. Threading a trace id through
 * those layers would require changing a dozen function signatures
 * across packages we don't control.
 *
 * A module-level holder works because the browser only ever has one
 * active copilot chat at a time (the UI gates sending a new one on
 * the stop-barrier). The chat-session hook writes this on the first
 * chat POST response and nulls it out when the stream terminates,
 * so client tool callbacks emitted during that window can read the
 * right value without plumbing.
 *
 * Not an `export const obj`; using getters/setters so callers can't
 * accidentally mutate the backing field (e.g. a stale ref held from
 * before a new chat started). Keep this module tiny — it has one
 * job.
 */

let currentTraceparent: string | undefined

/**
 * Set the traceparent for the current chat stream. Called by the
 * chat-session hook after receiving the `traceparent` response
 * header from the initial chat POST. Pass `undefined` to clear it
 * when the stream terminates or a new chat begins.
 */
export function setCurrentChatTraceparent(value: string | undefined): void {
  currentTraceparent = value
}

/**
 * Read the traceparent for the currently-active chat. Returns
 * `undefined` if no chat is in-flight — callers should fall through
 * without a traceparent header in that case, NOT block or throw.
 */
export function getCurrentChatTraceparent(): string | undefined {
  return currentTraceparent
}

/**
 * Convenience: header spread suitable for inclusion in `fetch` init
 * objects. Returns `{}` when no traceparent is set so the spread is
 * safe to use unconditionally:
 *
 *     await fetch(url, { headers: { ...tracepa rentHeader(), ... } })
 */
export function traceparentHeader(): Record<string, string> {
  const tp = currentTraceparent
  return tp ? { traceparent: tp } : {}
}
