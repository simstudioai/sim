import { type NextRequest, NextResponse } from 'next/server'
import { getBaseUrl } from '@/lib/core/utils/urls'

function getOrigin(): string {
  return getBaseUrl().replace(/\/$/, '')
}

export function createMcpAuthorizationServerMetadataResponse(request: NextRequest): NextResponse {
  const origin = getOrigin()
  const resource = `${origin}/api/mcp/copilot`

  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
      token_endpoint: `${origin}/api/auth/oauth2/token`,
      registration_endpoint: `${origin}/api/auth/oauth2/register`,
      jwks_uri: `${origin}/api/auth/jwks`,
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'mcp:tools'],
      resource,
      x_sim_auth: {
        type: 'api_key',
        header: 'x-api-key',
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  )
}

export function createMcpProtectedResourceMetadataResponse(request: NextRequest): NextResponse {
  const origin = getOrigin()
  const resource = `${origin}/api/mcp/copilot`
  const authorizationServerIssuer = origin

  return NextResponse.json(
    {
      resource,
      // RFC 9728 expects issuer identifiers here, not metadata URLs.
      authorization_servers: [authorizationServerIssuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:tools'],
      // Non-standard extension for API-key-only clients.
      x_sim_auth: {
        type: 'api_key',
        header: 'x-api-key',
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  )
}
