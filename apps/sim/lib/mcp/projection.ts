import type { McpServerRow } from '@/lib/mcp/queries'

/**
 * Presence and key names of a server's custom headers, with the values dropped.
 *
 * Custom MCP headers routinely carry the upstream credential (`Authorization:
 * Bearer …`, `X-API-Key: …`) and are stored unencrypted, so no read surface may
 * echo their values back. Only whether headers exist and what they are called
 * is safe to expose.
 */
export interface McpHeaderProjection {
  hasHeaders: boolean
  headerNames: string[]
}

export function projectMcpHeaders(headers: unknown): McpHeaderProjection {
  const record =
    headers && typeof headers === 'object' ? (headers as Record<string, unknown>) : undefined
  const headerNames = record ? Object.keys(record) : []
  return { hasHeaders: headerNames.length > 0, headerNames }
}

/** An MCP server row as the internal API returns it. */
export type InternalMcpServer = Omit<McpServerRow, 'oauthClientSecret' | 'headers'> &
  McpHeaderProjection & {
    hasOauthClientSecret: boolean
    /**
     * Present only for callers holding write/admin on the workspace, who need the
     * current values to round-trip them through the settings edit form.
     */
    headers?: Record<string, string>
  }

/**
 * Projects a stored MCP server row onto the internal API shape.
 *
 * `oauthClientSecret` is always reduced to a boolean, and header values are
 * withheld unless the caller may already rewrite them. Every caller gets
 * `hasHeaders`/`headerNames`.
 */
export function projectInternalMcpServer(
  row: McpServerRow,
  options: { includeHeaderValues: boolean }
): InternalMcpServer {
  const { oauthClientSecret, headers, ...rest } = row
  const projected: InternalMcpServer = {
    ...rest,
    ...projectMcpHeaders(headers),
    hasOauthClientSecret: Boolean(oauthClientSecret),
  }
  if (options.includeHeaderValues && headers) {
    projected.headers = headers as Record<string, string>
  }
  return projected
}
