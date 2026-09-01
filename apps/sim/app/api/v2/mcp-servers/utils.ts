import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpError as McpSdkError } from '@modelcontextprotocol/sdk/types.js'
import { type V2McpServer, v2McpServerSchema } from '@/lib/api/contracts/v2/mcp-servers'
import { createV2ResourceConcealmentPolicy, type V2ErrorPolicy } from '@/lib/api/server/routes'
import { isTimeoutError } from '@/lib/core/execution-limits'
import { projectMcpHeaders } from '@/lib/mcp/projection'
import type { McpServerRow } from '@/lib/mcp/queries'
import {
  McpConnectionError,
  McpOauthAuthorizationRequiredError,
  McpServerCooldownError,
} from '@/lib/mcp/types'
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

export const mcpServerResourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'MCP server not found',
})

/**
 * `error.details.code` on the 409 a stale MCP OAuth grant produces.
 *
 * 409 carries more than one cause across the v2 surface, so the discriminator is
 * what lets a client branch without matching on prose. It is published in the
 * operation description.
 */
export const MCP_SERVER_REAUTHORIZATION_REQUIRED = 'MCP_SERVER_REAUTHORIZATION_REQUIRED'

/**
 * Caller-safe wording for a third-party server that did not answer usefully.
 *
 * Every branch returns a constant, so an upstream message — which may quote a
 * hostname, a token endpoint, or a stack — never reaches the caller.
 *
 * Selection is typed, never matched on message text: `McpConnectionError`
 * interpolates the server's display name into its message, so a server named
 * after the word `cooldown` would select the cooldown branch it is not in.
 */
function unreachableServerMessage(error: unknown): string {
  if (isTimeoutError(error)) return 'The MCP server took too long to respond'
  if (error instanceof McpServerCooldownError) {
    return 'The MCP server recently failed and is in cooldown'
  }
  return 'The MCP server could not be reached'
}

/**
 * Renders a tool-discovery failure.
 *
 * Discovery talks to a server the caller registered, so its failures are
 * ordinary operating conditions rather than Sim faults: an unreachable, slow, or
 * cooling-down server is a retryable 503 (`v2Error` stamps it with
 * `Retry-After`), and a server whose stored OAuth grant no longer works is a 409
 * — the registration exists but its grant no longer does, which is a state
 * conflict a human resolves by reauthorizing. Answering all of those with a bare
 * 500 would make the endpoint that completes MCP onboarding indistinguishable
 * from a Sim outage.
 *
 * The reauthorization case deliberately does **not** reuse 401. On this surface
 * 401 means exactly one thing — the Sim API key is missing or invalid — and the
 * published response description says so; a client that reacted to it by
 * rotating or refreshing its Sim key would loop forever without touching the
 * actual problem. It is also not a 403: the caller's rights on the Sim resource
 * are fine.
 *
 * Classification is a typed dispatch over the MCP error families rather than
 * `categorizeError`'s substring fallback. That fallback reaches 400 on any
 * message containing `invalid`, which misattributed two different faults to the
 * caller: an upstream JSON-RPC `Invalid params`, and — because the builder
 * `.parse`s the response on the way out — a Sim-side response-schema defect,
 * whose `ZodError` message carries `invalid_type`. The second is the worse of
 * the two: answering it here suppressed the builder's 500 and its
 * unhandled-error logging on the one v2 endpoint whose payload shape is authored
 * by a third party. Anything unrecognised now returns `null` and keeps that
 * generic 500.
 */
export const v2McpToolDiscoveryErrorPolicy = {
  render(error) {
    const orchestrated = mcpServerResourceErrorPolicy.render(error)
    if (orchestrated) return orchestrated

    if (error instanceof McpOauthAuthorizationRequiredError || error instanceof UnauthorizedError) {
      return v2Error(
        'CONFLICT',
        'The MCP server must be reauthorized in Sim before its tools can be listed',
        { details: { code: MCP_SERVER_REAUTHORIZATION_REQUIRED } }
      )
    }

    if (
      isTimeoutError(error) ||
      error instanceof McpConnectionError ||
      error instanceof McpSdkError ||
      error instanceof StreamableHTTPError
    ) {
      return v2Error('SERVICE_UNAVAILABLE', unreachableServerMessage(error))
    }

    return null
  },
} satisfies V2ErrorPolicy
