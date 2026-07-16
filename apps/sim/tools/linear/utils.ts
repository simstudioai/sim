/**
 * Builds the Authorization header value for Linear API requests.
 *
 * Linear documents two credential shapes: OAuth access tokens are sent as
 * `Authorization: Bearer <token>`, while personal API keys (prefixed with
 * `lin_api_`) must be sent bare as `Authorization: <key>` with no scheme.
 * This helper detects the personal-key prefix and returns the correct form
 * so tools work with both OAuth connections and pasted API keys.
 *
 * @param accessToken - OAuth access token or Linear personal API key
 * @returns The value to use for the `Authorization` header
 */
export function linearAuthorizationHeader(accessToken: string): string {
  return accessToken.startsWith('lin_api_') ? accessToken : `Bearer ${accessToken}`
}
