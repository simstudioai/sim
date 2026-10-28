import { getSimMcpUrl, SIM_MCP_ROUTE_PATH } from '@/lib/api/mcp/urls'
import { getBaseUrl } from '@/lib/core/utils/urls'

const PROTECTED_RESOURCE_METADATA = '/.well-known/oauth-protected-resource'
const AUTHORIZATION_SERVER_METADATA = '/.well-known/oauth-authorization-server'
const OPENAI_APPS_CHALLENGE = '/.well-known/openai-apps-challenge'

/**
 * A `Host` header as a URL authority under `protocol`: lower-cased, without the
 * trailing root dot, and without the scheme's default port, so it compares
 * equal to `URL.host`. `null` when the header is not a valid authority.
 */
function authorityOf(host: string, protocol: string): string | null {
  const normalized = host.replace(/\.(?=:\d+$|$)/, '')
  return URL.canParse(`${protocol}//${normalized}`)
    ? new URL(`${protocol}//${normalized}`).host
    : null
}

/**
 * Routes requests for the Sim MCP server's canonical URL.
 *
 * On the MCP URL's host, the MCP path and its RFC 9728 metadata map onto the
 * app routes that serve them. A dedicated host (`mcp.sim.ai`) also serves:
 * - the same metadata at the root well-known path, which MCP clients try after
 *   the path-inserted one (MCP authorization, Protected Resource Metadata Discovery);
 * - the authorization-server metadata older clients look for at the resource origin.
 *
 * Every other path on a dedicated host is `not_found`, and the app host answers
 * `not_found` for the internal MCP paths, so the server has exactly one URL and
 * every client binds its tokens to it. `null` leaves the request to the rest of
 * the proxy.
 *
 * Reads `Host` rather than `X-Forwarded-Host`, which a client could set to
 * reach the rest of the app through the dedicated host.
 */
export function resolveSimMcpHostPath(
  host: string | null,
  pathname: string
): string | 'not_found' | null {
  const mcp = new URL(getSimMcpUrl())
  const dedicated = mcp.origin !== new URL(getBaseUrl()).origin
  const internalMetadataPath = `${PROTECTED_RESOURCE_METADATA}${SIM_MCP_ROUTE_PATH}`
  if (!host || authorityOf(host, mcp.protocol) !== mcp.host) {
    return dedicated && (pathname === SIM_MCP_ROUTE_PATH || pathname === internalMetadataPath)
      ? 'not_found'
      : null
  }
  if (pathname === mcp.pathname) return SIM_MCP_ROUTE_PATH
  if (pathname === `${PROTECTED_RESOURCE_METADATA}${mcp.pathname}`) return internalMetadataPath
  if (!dedicated) return null
  if (pathname === PROTECTED_RESOURCE_METADATA) return internalMetadataPath
  return pathname === AUTHORIZATION_SERVER_METADATA || pathname === OPENAI_APPS_CHALLENGE
    ? pathname
    : 'not_found'
}

/**
 * For a route the proxy does not run on: whether the request came in through the dedicated MCP
 * host, which serves nothing but the MCP server. Such a route answers it as not found itself, as
 * the proxy would have.
 */
export function isOffAppHost(request: { headers: Headers; url: string }): boolean {
  return (
    resolveSimMcpHostPath(request.headers.get('host'), new URL(request.url).pathname) ===
    'not_found'
  )
}
