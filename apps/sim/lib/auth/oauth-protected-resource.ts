import { NextResponse } from 'next/server'
import { getBaseUrl } from '@/lib/core/utils/urls'

/** An MCP endpoint protected by Sim's OAuth authorization server. */
export interface OAuthProtectedResource {
  /** The canonical resource URL tokens are bound to. */
  resource: string
  /** Human-readable name clients show while connecting. */
  name: string
  /** Scopes a token for this resource may carry. */
  scopes: readonly string[]
}

/** RFC 9728 metadata location for a resource: the well-known prefix inserted before its path. */
function getProtectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource)
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`
}

/** Public protocol metadata describes the endpoint without looking up protected data. */
export function protectedResourceMetadataResponse({
  resource,
  name,
  scopes,
}: OAuthProtectedResource) {
  return NextResponse.json(
    {
      resource,
      resource_name: name,
      authorization_servers: [`${getBaseUrl()}/api/auth`],
      scopes_supported: scopes,
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

/**
 * Points a refused request at the resource's metadata (RFC 9728 §5.1), keeping
 * the route's RFC 6750 error code (`invalid_token` tells a client to refresh). A
 * `401` asks for every scope the resource grants; an `insufficient_scope` `403`
 * keeps the scope the request needed, so the client can step up to exactly that.
 */
export function withOAuthResourceChallenge<T extends Response>(
  response: T,
  { resource, scopes }: Pick<OAuthProtectedResource, 'resource' | 'scopes'>
): T {
  const existing = response.headers.get('WWW-Authenticate')
  const insufficientScope = response.status === 403 && existing?.includes('insufficient_scope')
  if (response.status !== 401 && !insufficientScope) return response
  const scope = insufficientScope
    ? (existing?.match(/scope="([^"]*)"/)?.[1] ?? scopes.join(' '))
    : scopes.join(' ')
  const reason = existing?.match(/error="([^"]*)"/)?.[1]
  const error = reason ? `error="${reason}", ` : ''
  response.headers.set(
    'WWW-Authenticate',
    `Bearer ${error}resource_metadata="${getProtectedResourceMetadataUrl(resource)}", scope="${scope}"`
  )
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
