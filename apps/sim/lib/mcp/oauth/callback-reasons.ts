/**
 * Reasons surfaced from the OAuth callback popup back to the parent window via
 * `window.opener.postMessage`. Consumed by the popup hook to render user-facing
 * status messages and by the callback route to discriminate failure modes.
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
  reason?: McpOauthCallbackReason
}
