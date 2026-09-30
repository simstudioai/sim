import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { ManagedMcpOauthProvider } from '@/lib/mcp/oauth/managed-provider'
import { SimMcpOauthProvider } from '@/lib/mcp/oauth/provider'
import { createSsrfGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'

type McpAuthOptions = Parameters<typeof auth>[1]

/**
 * Wraps the MCP SDK's `auth()` and defaults `fetchFn` to the SSRF-guarded
 * fetch. Every URL touched during an MCP OAuth exchange — discovery,
 * authorization, token, and revocation endpoints — can come from
 * attacker-controllable authorization-server metadata, so callers must not
 * be able to omit the guard by forgetting to pass `fetchFn` explicitly.
 * Pass `fetchFn` in `options` to override (e.g. in tests).
 */
export function mcpAuthGuarded(
  provider: OAuthClientProvider,
  options: McpAuthOptions
): ReturnType<typeof auth> {
  return auth(provider, {
    ...options,
    ...((provider instanceof ManagedMcpOauthProvider || provider instanceof SimMcpOauthProvider) &&
    provider.authorizationScope
      ? { scope: provider.authorizationScope }
      : {}),
    fetchFn: options.fetchFn ?? createSsrfGuardedMcpFetch({ serverUrl: String(options.serverUrl) }),
  })
}
