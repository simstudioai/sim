import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { isAuthDisabled } from '@/lib/core/config/env-flags'

const DISCOVERY_CACHE_SECONDS = 300

const DISCOVERY_HEADERS = {
  'Cache-Control': `public, max-age=${DISCOVERY_CACHE_SECONDS}`,
  'Access-Control-Allow-Origin': '*',
} as const

/** The client authentication Sim's own token and revocation routes implement. */
const SIM_CLIENT_AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'] as const

/**
 * OAuth authorization-server metadata limited to what Sim's protocol routes
 * serve.
 *
 * Sim owns the token and revocation endpoints and accepts only the client
 * authentication methods above, issues bearer tokens only, exposes no
 * introspection, and runs without the JWT plugin. The provider's document also
 * advertises `private_key_jwt`, DPoP, introspection, and back-channel logout,
 * so only the fields Sim honors are copied.
 */
export async function getOAuthProviderMetadata() {
  const metadata = await auth.api.getOAuthServerConfig()
  return {
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint: metadata.registration_endpoint,
    revocation_endpoint: metadata.revocation_endpoint,
    scopes_supported: metadata.scopes_supported,
    response_types_supported: metadata.response_types_supported,
    response_modes_supported: metadata.response_modes_supported,
    grant_types_supported: metadata.grant_types_supported,
    code_challenge_methods_supported: metadata.code_challenge_methods_supported,
    authorization_response_iss_parameter_supported:
      metadata.authorization_response_iss_parameter_supported,
    token_endpoint_auth_methods_supported: SIM_CLIENT_AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: SIM_CLIENT_AUTH_METHODS,
  }
}

/** One response contract for every RFC 8414 discovery alias Sim exposes. */
export async function getOAuthProviderMetadataResponse(): Promise<NextResponse> {
  if (isAuthDisabled) {
    return NextResponse.json(
      { error: 'OAuth provider is not enabled' },
      { status: 404, headers: { ...DISCOVERY_HEADERS, 'Cache-Control': 'no-store' } }
    )
  }
  return NextResponse.json(await getOAuthProviderMetadata(), { headers: DISCOVERY_HEADERS })
}
