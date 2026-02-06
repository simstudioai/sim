import { type NextRequest, NextResponse } from 'next/server'

function getOrigin(request: NextRequest): string {
  return request.nextUrl.origin
}

export function createMcpAuthorizationServerMetadataResponse(request: NextRequest): NextResponse {
  const origin = getOrigin(request)
  const resource = `${origin}/api/mcp/copilot`

  return NextResponse.json(
    {
      issuer: resource,
      token_endpoint: `${origin}/api/auth/oauth/token`,
      token_endpoint_auth_methods_supported: ['none'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:tools'],
      resource,
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

export function createMcpProtectedResourceMetadataResponse(request: NextRequest): NextResponse {
  const origin = getOrigin(request)
  const resource = `${origin}/api/mcp/copilot`
  const authorizationServerIssuer = `${origin}/api/mcp/copilot`

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
