import type { NextResponse } from 'next/server'
import { type V2McpServer, v2McpServerSchema } from '@/lib/api/contracts/v2/mcp-servers'
import { projectMcpHeaders } from '@/lib/mcp/projection'
import type { McpServerRow } from '@/lib/mcp/queries'
import { v2Error } from '@/app/api/v2/lib/response'

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
