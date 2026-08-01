/**
 * Reasons surfaced from the OAuth callback popup back to the parent window over a
 * same-origin `BroadcastChannel`. A provider whose authorization page sets
 * `Cross-Origin-Opener-Policy: same-origin` severs `window.opener`, so a targeted
 * `postMessage` from the popup can be lost; a BroadcastChannel is origin-scoped and
 * unaffected. Consumed by the popup hook to render user-facing status messages and
 * by the callback route to discriminate failure modes.
 */
export type McpOauthCallbackReason =
  | 'authorized'
  | 'provider_error'
  | 'missing_params'
  | 'unauthenticated'
  | 'invalid_state'
  | 'user_mismatch'
  | 'server_gone'
  | 'insecure_url'
  | 'token_exchange_failed'
  | 'unknown'

export interface McpOauthCallbackMessage {
  type: 'mcp-oauth'
  ok: boolean
  serverId?: string
  /**
   * The OAuth `state` nonce, echoed on every result — including failures that can't resolve
   * a serverId. The opener correlates a broadcast to the exact flow it started by matching
   * this, so other same-origin tabs ignore it. Absent only on a malformed callback with no
   * parseable state.
   */
  state?: string
  reason?: McpOauthCallbackReason
}
