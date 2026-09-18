import { isPlainRecord } from '@sim/utils/object'
import type { NextRequest } from 'next/server'
import { v2McpOperations } from '@/lib/api/application/operations'
import { simMcpContract } from '@/lib/api/contracts/sim-mcp'
import { getMcpOperation, resolveOperation, TOOL_NAMES } from '@/lib/api/mcp/catalog'
import { withSimMcpAuthChallenge } from '@/lib/api/mcp/oauth-metadata'
import { createSimMcpServer } from '@/lib/api/mcp/server'
import { getSimMcpUrl } from '@/lib/api/mcp/urls'
import { parseRequest } from '@/lib/api/server'
import {
  mcpCredentialAuth,
  mcpMethodNotAllowed,
  readMcpCredentialHeaders,
  serveStatelessMcp,
} from '@/lib/api/server/routes/mcp-server-route'
import {
  admitV2Request,
  v2RateLimits,
  v2RouteOperation,
} from '@/lib/api/server/routes/v2-json-route'
import type { OAuthAccessTokenOptions } from '@/lib/auth/oauth-access-token'
import { type ApplicationOperation, requireOAuthOperationScope } from '@/lib/core/application'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

/** Matches the largest body an ordinary v2 JSON route accepts; each route still applies its own limit. */
const MAX_MCP_BODY_BYTES = 10 * 1024 * 1024

/**
 * OAuth tokens must be bound to this server, or be an existing unbound Sim API
 * grant such as the CLI's — the same API either way.
 */
function simMcpAudience(): OAuthAccessTokenOptions {
  return { resource: getSimMcpUrl(), allowUnboundApiTokens: true }
}

function admit(request: NextRequest) {
  return admitV2Request(
    request,
    v2McpOperations.connect,
    mcpCredentialAuth(simMcpAudience()),
    v2RateLimits.publicApi
  )
}

/**
 * The v2 operation a JSON-RPC message will run, when it calls the read or write
 * tool with a known operation. Its OAuth scope is checked before the SDK runs,
 * so a token without it gets the protocol's `insufficient_scope` step-up
 * challenge rather than a tool error. Raw routes declare no operation and all
 * change something, so they need `api:write`.
 */
async function toolCallOperation(
  message: Record<string, unknown>
): Promise<ApplicationOperation | null> {
  if (message.method !== 'tools/call' || !isPlainRecord(message.params)) return null
  const { name, arguments: args } = message.params
  if (name !== TOOL_NAMES.read && name !== TOOL_NAMES.write) return null
  if (!isPlainRecord(args) || typeof args.operation !== 'string') return null
  const resolved = await resolveOperation(
    args.operation,
    name === TOOL_NAMES.read ? 'read' : 'write'
  )
  if ('error' in resolved) return null
  const route = await getMcpOperation(resolved.operation).handler()
  return v2RouteOperation(route) ?? v2McpOperations.rawRoute
}

/** Browsers may only reach the server from Sim's own origins (DNS-rebinding protection). */
function isAllowedOrigin(origin: string | null): boolean {
  return !origin || isSameOrigin(origin) || isSameOrigin(origin, getSimMcpUrl())
}

export function createSimMcpHandlers() {
  /** JSON-RPC is a protocol boundary; every tool call is dispatched to its own v2 route. */
  const handler = withRouteHandler(async (request: NextRequest) => {
    const admission = await admit(request)
    if (!admission.success) return withSimMcpAuthChallenge(admission.response)
    if (!isAllowedOrigin(request.headers.get('origin'))) {
      return v2Error('FORBIDDEN', 'Origin is not allowed')
    }
    try {
      const parsed = await parseRequest(
        simMcpContract,
        request,
        {},
        { maxBodyBytes: MAX_MCP_BODY_BYTES }
      )
      if (!parsed.success) return parsed.response
      const operation = await toolCallOperation(parsed.data.body)
      if (operation) requireOAuthOperationScope(admission.auth.principal, operation)
      const server = createSimMcpServer({
        inbound: request,
        credential: readMcpCredentialHeaders(request.headers),
        audience: simMcpAudience(),
      })
      return await serveStatelessMcp(server, request, parsed.data.body)
    } catch (error) {
      const response = v2CaughtOrchestrationError(error)
      if (response) return withSimMcpAuthChallenge(response)
      throw error
    }
  })

  /** Stateless clients use POST only; authenticate unsupported methods before returning 405. */
  const unsupportedMethod = withRouteHandler(async (request: NextRequest) => {
    const admission = await admit(request)
    if (!admission.success) return withSimMcpAuthChallenge(admission.response)
    return mcpMethodNotAllowed()
  })

  return { POST: handler, GET: unsupportedMethod, DELETE: unsupportedMethod }
}
