import { parseBearerToken } from '@/lib/auth/oauth-access-token'
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@/lib/auth/oauth-provider'

export interface V2CredentialHeaders {
  apiKey: string | null
  bearer: string | null
}

/**
 * The credentials a v2 request presents, read from its headers.
 *
 * Separate from the verifier because reading a header is not authentication:
 * the route builders ask this before authenticating, to tell an anonymous
 * request from one carrying a credential, and every route test mocks the
 * verifier module to keep the database out of reach. Leaving these there made
 * the pure request-shape question unavailable to any of them.
 */
export function readV2CredentialHeaders(headers: Headers): V2CredentialHeaders {
  return { apiKey: headers.get('x-api-key'), bearer: parseBearerToken(headers) }
}

/**
 * Whether the request presents any credential v2 knows how to read.
 *
 * A bearer counts only when it carries Sim's own access-token prefix. The
 * optional-auth path uses this to tell an anonymous request from an
 * authenticated one, and a public deployed workflow is routinely called by a
 * gateway that forwards its own unrelated `Authorization` header — treating
 * that as a Sim credential would turn a working anonymous execution into a
 * 401. A bearer that is not one of ours was never a v2 credential.
 */
export function hasV2Credential(headers: Headers): boolean {
  const credential = readV2CredentialHeaders(headers)
  if (credential.apiKey !== null) return true
  return credential.bearer?.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) === true
}
