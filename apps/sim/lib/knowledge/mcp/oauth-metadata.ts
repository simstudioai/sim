import { NextResponse } from 'next/server'
import { OAUTH_SEARCH_SCOPES } from '@/lib/auth/oauth-provider'
import { getBaseUrl } from '@/lib/core/utils/urls'

/** Public protocol metadata describes the endpoint without looking up protected organization data. */
export function searchMcpResourceMetadata(resource: string) {
  return NextResponse.json(
    {
      resource,
      resource_name: 'Sim Search',
      authorization_servers: [`${getBaseUrl()}/api/auth`],
      scopes_supported: OAUTH_SEARCH_SCOPES,
      bearer_methods_supported: ['header'],
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    }
  )
}

/** Requests refresh consent so clients that follow the challenge can stay connected after expiry. */
export function withSearchMcpAuthChallenge<T extends Response>(response: T, resource: string): T {
  if (
    response.status !== 401 &&
    response.headers.get('WWW-Authenticate')?.includes('insufficient_scope') !== true
  ) {
    return response
  }
  const url = new URL(resource)
  const metadata = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`
  const error = response.status === 403 ? 'error="insufficient_scope", ' : ''
  response.headers.set(
    'WWW-Authenticate',
    `Bearer ${error}resource_metadata="${metadata}", scope="${OAUTH_SEARCH_SCOPES.join(' ')}"`
  )
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
