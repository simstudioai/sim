import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { isAuthDisabled } from '@/lib/core/config/env-flags'

const DISCOVERY_CACHE_SECONDS = 300

const DISCOVERY_HEADERS = {
  'Cache-Control': `public, max-age=${DISCOVERY_CACHE_SECONDS}`,
  'Access-Control-Allow-Origin': '*',
} as const

/**
 * OAuth authorization-server metadata with Sim's registered public-client
 * authentication method included.
 *
 * Public Search clients and the first-party CLI use `none` for token exchange
 * and revocation. Introspection is not exposed by Sim's protocol routes.
 */
export async function getOAuthProviderMetadata() {
  const metadata = await auth.api.getOAuthServerConfig()
  const {
    introspection_endpoint: _introspectionEndpoint,
    introspection_endpoint_auth_methods_supported: _introspectionAuthMethods,
    ...supportedMetadata
  } = metadata
  const publicClientAuthMethods = (methods: string[] | undefined) => [
    ...new Set([...(methods ?? []), 'none']),
  ]
  return {
    ...supportedMetadata,
    token_endpoint_auth_methods_supported: publicClientAuthMethods(
      metadata.token_endpoint_auth_methods_supported
    ),
    revocation_endpoint_auth_methods_supported: publicClientAuthMethods(
      metadata.revocation_endpoint_auth_methods_supported
    ),
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
