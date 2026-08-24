/**
 * Redirect behavior for outbound HTTP requests.
 *
 * `legacy` preserves Sim's historical replay semantics for persisted workflows, while
 * `standard` follows Fetch-compatible method rules. Credential forwarding is controlled
 * independently in both modes.
 */
export interface HttpRedirectPolicy {
  mode: 'legacy' | 'standard'
  sendCredentialsOnCrossOriginRedirect: boolean
  sensitiveHeaders?: readonly string[]
}
