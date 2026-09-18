import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { NextRequest } from 'next/server'
import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import type { V2CredentialHeaders } from '@/lib/api/server/routes/v2-credential-headers'
import { type OAuthAccessTokenOptions, parseBearerToken } from '@/lib/auth/oauth-access-token'
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@/lib/auth/oauth-provider'

const NO_STORE = 'private, no-store'

/**
 * The credential an MCP request presents. MCP clients send whatever they hold
 * as `Authorization: Bearer`, so a bearer that is not one of Sim's OAuth access
 * tokens is an API key. `x-api-key` is accepted too; two different credentials
 * are refused rather than one being silently chosen.
 */
export function readMcpCredentialHeaders(headers: Headers): V2CredentialHeaders {
  const apiKey = headers.get('x-api-key')
  const bearer = parseBearerToken(headers)
  if ((headers.has('authorization') && !bearer) || (apiKey && bearer && apiKey !== bearer)) {
    throw new V2ApiKeyUnauthenticatedError('Provide one valid API key')
  }
  const oauthBearer = bearer?.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) ? bearer : null
  return { apiKey: apiKey ?? (oauthBearer ? null : bearer), bearer: oauthBearer }
}

/** Authenticates an MCP request, verifying OAuth tokens against the server's own audience. */
export function mcpCredentialAuth(audience: OAuthAccessTokenOptions) {
  return {
    authenticate(request: NextRequest) {
      return authenticateV2ApiKey(readMcpCredentialHeaders(request.headers), audience)
    },
  }
}

/**
 * Serves one JSON-RPC message statelessly: the server exists for this request
 * only, so no credential outlives the request that presented it.
 */
export async function serveStatelessMcp(
  server: McpServer,
  request: Request,
  parsedBody: unknown
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request, { parsedBody })
    response.headers.set('Cache-Control', NO_STORE)
    return response
  } finally {
    await server.close()
  }
}

/** Stateless servers take POST only; callers authenticate before answering 405. */
export function mcpMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': NO_STORE } })
}
