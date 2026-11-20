/**
 * A stored MCP server as the declaration it prints as, and the write a declaration makes of it.
 * A credential header holding literal text prints as `stored()`, fingerprinted by a keyed hash of
 * its value: the value never leaves the server, and neither does a plain hash a short secret could
 * be guessed from.
 */
import { hmacSha256Hex } from '@sim/security/hmac'
import { withoutAuthScheme } from '@sim/workflow-code'
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

/** `{{NAME}}` env references. */
const ENV_REFERENCES = /\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g

/** Whether a header value is only env references (after an optional auth scheme word). */
function isEnvReferenceOnly(value: string): boolean {
  return withoutAuthScheme(value).replace(ENV_REFERENCES, '').trim() === ''
}

/**
 * The headers `decl` writes as literal text where `row` stores a value {@link concealHeaderValues}
 * hides: a reader who cannot see that value may keep it (`stored()`) or replace it with env
 * references, never compare text of their own with it.
 */
export function hiddenHeadersWritten(decl: McpServerDecl, row: McpServerRow): string[] {
  const stored = storedHeaders(row)
  return Object.entries(decl.headers ?? {}).flatMap(([name, header]) => {
    const value = stored[name]
    const hidden = value !== undefined && !isEnvReferenceOnly(value)
    return hidden && !isStoredHeader(header) && !isEnvReferenceOnly(header) ? [name] : []
  })
}

/**
 * `decl` (as {@link declOf} printed `row`) for a reader who may not see header values, as the MCP
 * server list withholds them from anyone who cannot rewrite them: every header holding literal
 * text prints as `stored()`, and only one made of env references prints as written.
 */
export function concealHeaderValues(decl: McpServerDecl, row: McpServerRow): McpServerDecl {
  if (!decl.headers) return decl
  const headers = Object.fromEntries(
    Object.entries(decl.headers).map(([name, header]): [string, McpHeaderDecl] => [
      name,
      isStoredHeader(header) || isEnvReferenceOnly(header)
        ? header
        : { stored: storedValueHash(row, name, header) },
    ])
  )
  return { ...decl, headers }
}

/** Whether `decl` keeps any header value the server stores (`stored()`). */
export function keepsStoredHeaders(decl: McpServerDecl): boolean {
  return Object.values(decl.headers ?? {}).some(isStoredHeader)
}

/** A stored server's fingerprint: of the declaration it prints as. */
export function storedFingerprint(row: McpServerRow): ResourceFingerprint {
  return fingerprintOf(mcpCodec.canonical(declOf(row)))
}

/**
 * `decl` with each `stored()` header resolved against `row`, the server it keeps values of, as
 * {@link declOf} prints that value: the keyed hash of a literal secret, the text of any other
 * value (one {@link concealHeaderValues} hid from a reader), so a directory a reader read applies
 * back unchanged. Returns the names `row` holds no value for (every `stored()` header when there
 * is no row).
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
      return [
        name,
        holdsLiteralSecret(name, value) ? { stored: storedValueHash(row, name, value) } : value,
      ]
    })
  )
  return { decl: { ...decl, headers }, missing }
}

/**
 * Whether `row` holds exactly what `decl` declares: its settings, and each `stored()` header the
 * value `from` holds under it when `from` is given (what a replace copies onto the server it
 * creates). That is the server an interrupted replace created and never bound to its key.
 */
export function holdsDeclaration(
  decl: McpServerDecl,
  row: McpServerRow,
  from?: McpServerRow
): boolean {
  const resolved = resolveStoredHeaders(decl, row)
  if (resolved.missing.length > 0) return false
  if (fingerprintOf(mcpCodec.canonical(resolved.decl)) !== storedFingerprint(row)) return false
  if (!from) return true
  const copied = storedHeaders(row)
  const kept = storedHeaders(from)
  return Object.entries(decl.headers ?? {}).every(
    ([name, header]) => !isStoredHeader(header) || copied[name] === kept[name]
  )
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
