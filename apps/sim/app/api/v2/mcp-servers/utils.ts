import type { NextResponse } from 'next/server'
import { type V2McpServer, v2McpServerSchema } from '@/lib/api/contracts/v2/mcp-servers'
import { createV2ResourceConcealmentPolicy, type V2ErrorPolicy } from '@/lib/api/server/routes'
import { projectMcpHeaders } from '@/lib/mcp/projection'
import type { McpServerRow } from '@/lib/mcp/queries'
import { categorizeError } from '@/lib/mcp/utils'
import { type V2ErrorCode, v2Error } from '@/app/api/v2/lib/response'

/**
 * Shared serialization + error mapping for the v2 MCP server surface.
 */

/**
 * Projects a stored MCP server row onto the public shape.
 *
 * The row is parsed through {@link v2McpServerSchema}, whose strip behaviour is
 * the security boundary: `headers`, `oauthClientSecret`, `statusConfig`, and the
 * rest of the row are dropped rather than enumerated by hand, so a column added
 * later cannot leak by omission. Header *names* are lifted out explicitly by
 * {@link projectMcpHeaders}, shared with the internal surface so both read
 * surfaces withhold header values by the same rule.
 */
export function toV2McpServer(row: McpServerRow): V2McpServer {
  return v2McpServerSchema.parse({
    ...row,
    ...projectMcpHeaders(row.headers),
    hasOauthClientSecret: Boolean(row.oauthClientSecret),
  })
}

/**
 * Renders an MCP orchestration failure in the v2 error envelope.
 *
 * `forbidden` is the domain-allowlist / SSRF rejection and keeps its 403.
 * `bad_gateway` is a DNS failure on the caller-supplied hostname — the caller's
 * input is at fault, so it surfaces as a 400 rather than implying a Sim outage.
 */
export function v2McpOrchestrationError(
  errorCode: string | undefined,
  message: string
): NextResponse {
  switch (errorCode) {
    case 'not_found':
      return v2Error('NOT_FOUND', 'MCP server not found')
    case 'forbidden':
      return v2Error('FORBIDDEN', message)
    case 'bad_gateway':
      return v2Error('BAD_REQUEST', message)
    default:
      return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
}

export const mcpServerResourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'MCP server not found',
})

/**
 * v2 code for a status {@link categorizeError} assigned a discovery failure.
 *
 * 408 and 502 collapse onto 503 because the v2 envelope publishes neither, and
 * both mean the same thing to a caller: the third-party server did not answer,
 * come back later. `v2Error` stamps the 503 with `Retry-After`. `500` is absent
 * on purpose — see {@link v2McpToolDiscoveryErrorPolicy}.
 */
const V2_CODE_BY_DISCOVERY_STATUS: Partial<Record<number, V2ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  408: 'SERVICE_UNAVAILABLE',
  502: 'SERVICE_UNAVAILABLE',
  503: 'SERVICE_UNAVAILABLE',
}

/**
 * Renders a tool-discovery failure.
 *
 * Discovery talks to a server the caller registered, so its failures are
 * ordinary operating conditions rather than Sim faults: an unreachable, slow, or
 * cooling-down server is a retryable 503, and a server whose stored OAuth grant
 * no longer works is a 401 telling the caller to reauthorize. Answering all of
 * those with a bare 500 would make the endpoint that completes MCP onboarding
 * indistinguishable from a Sim outage.
 *
 * `categorizeError` already owns that classification for the internal surface
 * and returns caller-safe generic messages, so it is reused rather than
 * re-derived. Anything it cannot classify falls through as `null`, which keeps
 * the builder's own generic 500 and its unhandled-error logging.
 */
export const v2McpToolDiscoveryErrorPolicy = {
  render(error) {
    const orchestrated = mcpServerResourceErrorPolicy.render(error)
    if (orchestrated) return orchestrated

    const { message, status } = categorizeError(error)
    const code = V2_CODE_BY_DISCOVERY_STATUS[status]
    return code ? v2Error(code, message) : null
  },
} satisfies V2ErrorPolicy
