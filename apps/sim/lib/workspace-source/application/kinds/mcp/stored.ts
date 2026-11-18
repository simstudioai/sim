/**
 * A stored MCP server as the declaration it prints as, and the write a declaration makes of it.
 * A credential header holding literal text prints as `stored()`, fingerprinted by a keyed hash of
 * its value: the value never leaves the server, and neither does a plain hash a short secret could
 * be guessed from.
 */
import { hmacSha256Hex } from '@sim/security/hmac'
import { fingerprintOf, type ResourceFingerprint } from '@sim/workspace-code'
import {
  holdsLiteralSecret,
  isStoredHeader,
  MCP_AUTH_TYPES,
  MCP_DEFAULTS,
  type McpAuthDecl,
  type McpHeaderDecl,
  type McpServerDecl,
  mcpCodec,
} from '@sim/workspace-code/kinds/mcp'
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { McpServerRow } from '@/lib/mcp/queries'

/** The stored headers, name → text; a non-text value (never written by Sim) is left out. */
function storedHeaders(row: Pick<McpServerRow, 'headers'>): Record<string, string> {
  const headers = row.headers
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) return {}
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

/** The keyed hash `stored()` fingerprints a stored header value by. */
function storedValueHash(row: Pick<McpServerRow, 'id'>, name: string, value: string): string {
  return hmacSha256Hex(
    `mcp-header\u0000${row.id}\u0000${name}\u0000${value}`,
    env.BETTER_AUTH_SECRET
  )
}

function isAuthType(value: string): value is McpAuthDecl['type'] {
  return (MCP_AUTH_TYPES as readonly string[]).includes(value)
}

/** A stored server as the declaration a get prints: every setting at its default left out. */
export function declOf(row: McpServerRow): McpServerDecl {
  const headers = Object.fromEntries(
    Object.entries(storedHeaders(row)).map(([name, value]): [string, McpHeaderDecl] => [
      name,
      holdsLiteralSecret(name, value) ? { stored: storedValueHash(row, name, value) } : value,
    ])
  )
  const authType = isAuthType(row.authType) ? row.authType : MCP_DEFAULTS.auth
  return {
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    url: row.url ?? '',
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(authType !== MCP_DEFAULTS.auth || row.oauthClientId
      ? {
          auth: {
            type: authType,
            ...(row.oauthClientId && authType === 'oauth' ? { clientId: row.oauthClientId } : {}),
          },
        }
      : {}),
    ...(row.timeout !== null && row.timeout !== MCP_DEFAULTS.timeout
      ? { timeout: row.timeout }
      : {}),
    ...(row.retries !== null && row.retries !== MCP_DEFAULTS.retries
      ? { retries: row.retries }
      : {}),
    ...(row.enabled ? {} : { enabled: false }),
  }
}

/** A stored server's fingerprint: of the declaration it prints as. */
export function storedFingerprint(row: McpServerRow): ResourceFingerprint {
  return fingerprintOf(mcpCodec.canonical(declOf(row)))
}

/**
 * `decl` with each `stored()` header resolved against `row`, the server it keeps values of: the
 * keyed hash of the value stored under that header. Returns the names `row` holds no value for
 * (every `stored()` header when there is no row).
 */
export function resolveStoredHeaders(
  decl: McpServerDecl,
  row: McpServerRow | undefined
): { decl: McpServerDecl; missing: string[] } {
  if (!decl.headers) return { decl, missing: [] }
  const stored = row ? storedHeaders(row) : {}
  const missing: string[] = []
  const headers = Object.fromEntries(
    Object.entries(decl.headers).map(([name, header]): [string, McpHeaderDecl] => {
      if (!isStoredHeader(header)) return [name, header]
      const value = stored[name]
      if (row === undefined || value === undefined) {
        missing.push(name)
        return [name, header]
      }
      return [name, { stored: storedValueHash(row, name, value) }]
    })
  )
  return { decl: { ...decl, headers }, missing }
}

/**
 * The headers a write stores for `decl`: its text as declared, and each `stored()` header the
 * value `row` holds under it now. Refuses one it has none for (removed since the plan).
 */
export function headersToWrite(
  decl: McpServerDecl,
  row: McpServerRow | undefined
): Record<string, string> {
  const stored = row ? storedHeaders(row) : {}
  return Object.fromEntries(
    Object.entries(decl.headers ?? {}).map(([name, header]) => {
      if (!isStoredHeader(header)) return [name, header]
      const value = stored[name]
      if (value === undefined) {
        throw new OrchestrationError(
          'validation',
          `The MCP server holds no value for header "${name}" to keep.`
        )
      }
      return [name, value]
    })
  )
}
