import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import type { V2CredentialHeaders } from '@/lib/api/server/routes/v2-credential-headers'
import {
  invalidJsonBodyResponse,
  type ParseRequestOptions,
  type RequestSlice,
  validationErrorResponse,
} from '@/lib/api/server/validation'
import { type OAuthAccessTokenOptions, parseBearerToken } from '@/lib/auth/oauth-access-token'
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@/lib/auth/oauth-provider'
import { describeResponseError, describeValidationError } from '@/lib/core/utils/response-error'

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
    if (response.status >= 400) await describeTransportRefusal(response, request)
    return response
  } finally {
    await server.close()
  }
}

const UNSUPPORTED_PROTOCOL_VERSION = 'Bad Request: Unsupported protocol version'

/**
 * Records why the SDK transport refused a request (an unsupported
 * `mcp-protocol-version`, a malformed JSON-RPC message) for the route's log
 * line. The SDK's messages are fixed text, except for a value after a second
 * `: `, which is dropped; an unsupported protocol version is kept, bounded, as
 * the detail instead.
 */
async function describeTransportRefusal(response: Response, request: Request): Promise<void> {
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return
  }
  const error = isRecordLike(body) ? body.error : undefined
  if (!isRecordLike(error)) return
  const reason =
    typeof error.message === 'string'
      ? truncate(error.message.split(': ', 2).join(': '), 200)
      : undefined
  const protocolVersion = request.headers.get('mcp-protocol-version')
  describeResponseError(response, {
    errorCode: String(error.code),
    ...(reason ? { errorReason: reason } : {}),
    ...(protocolVersion && reason === UNSUPPORTED_PROTOCOL_VERSION
      ? { errorDetail: truncate(protocolVersion, 40) }
      : {}),
  })
}

/**
 * `parseRequest` options for an MCP route: the default 400 bodies, described
 * for the route's log line. A JSON-RPC message keeps keys the caller chose, so
 * a validation failure names only the slice.
 */
export const MCP_PARSE_ERROR_RESPONSES = {
  validationErrorResponseBySlice(error: z.ZodError, slice: RequestSlice) {
    const response = validationErrorResponse(error)
    describeValidationError(response, error, slice, { sliceOnly: true })
    return response
  },
  invalidJsonResponse() {
    const response = invalidJsonBodyResponse()
    describeResponseError(response, { errorCode: 'BAD_REQUEST', errorReason: 'invalid_json' })
    return response
  },
} satisfies ParseRequestOptions

/** Stateless servers take POST only; callers authenticate before answering 405. */
export function mcpMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': NO_STORE } })
}
