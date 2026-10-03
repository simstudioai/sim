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
  /**
   * Permits replaying the request body to a redirect target on another origin.
   *
   * Off by default, and rarely the right answer: a 307 or 308 preserves the body
   * verbatim, so a server that redirects a credential-bearing POST — a login
   * form, a signed webhook payload — hands it to whatever host it names. RFC 9110
   * allows the replay because it assumes the redirect comes from a server you
   * already trust with the body, which is exactly the assumption a cross-origin
   * hop breaks.
   *
   * Set this only where a provider documents a cross-origin redirect that needs
   * the body, and where the body carries nothing the target should not see.
   */
  allowCrossOriginBody?: boolean
}
