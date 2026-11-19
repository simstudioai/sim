import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { isPlainRecord } from '@sim/utils/object'
import type { NextRequest } from 'next/server'
import { v2McpOperations } from '@/lib/api/application/operations'
import { simMcpContract } from '@/lib/api/contracts/sim-mcp'
import {
  CODE_TOOL_NAMES,
  getMcpOperation,
  resolveOperation,
  TOOL_NAMES,
} from '@/lib/api/mcp/catalog'
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
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
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
 * change something, so they need `api:write`, as does the write code tool,
 * whose programs may run any operation. The read code tool needs only the
 * `api:read` every connection already holds.
 */
async function toolCallOperation(
  message: Record<string, unknown>
): Promise<ApplicationOperation | null> {
  if (message.method !== 'tools/call' || !isPlainRecord(message.params)) return null
  const { name, arguments: args } = message.params
  if (name === CODE_TOOL_NAMES.write) return v2McpOperations.rawRoute
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

/**
 * Whether a message's answer depends on the code-mode flag: the instructions
 * and tool list mention the code tools, and a call may run one.
 */
function readsCodeMode(message: Record<string, unknown>): boolean {
  if (message.method === 'initialize' || message.method === 'tools/list') return true
  if (message.method !== 'tools/call' || !isPlainRecord(message.params)) return false
  const { name } = message.params
  return name === CODE_TOOL_NAMES.read || name === CODE_TOOL_NAMES.write
}

/**
 * The code tools when the flag is on for this caller, keyed for the sandbox
 * pool's per-caller fairness by the person or workspace calling.
 */
async function codeModeFor(principal: Principal): Promise<{ ownerKey: string } | null> {
  const userId = resolvePrincipalSubjectUserId(principal)
  const workspaceId = principal.kind === 'workspace_api_key' ? principal.workspaceId : undefined
  if (!(await isFeatureEnabled('mcp-code-mode', { userId, workspaceId }))) return null
  if (userId) return { ownerKey: `user:${userId}` }
  if (workspaceId) return { ownerKey: `workspace:${workspaceId}` }
  return null
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
      const server = createSimMcpServer(
        {
          inbound: request,
          credential: readMcpCredentialHeaders(request.headers),
          audience: simMcpAudience(),
        },
        {
          codeMode: readsCodeMode(parsed.data.body)
            ? await codeModeFor(admission.auth.principal)
            : null,
        }
      )
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
