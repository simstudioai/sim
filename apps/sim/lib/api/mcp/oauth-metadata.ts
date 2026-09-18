import { getSimMcpUrl } from '@/lib/api/mcp/urls'
import {
  type OAuthProtectedResource,
  protectedResourceMetadataResponse,
  withOAuthResourceChallenge,
} from '@/lib/auth/oauth-protected-resource'
import { OAUTH_API_READ_SCOPE, OAUTH_API_WRITE_SCOPE } from '@/lib/auth/oauth-provider'

/**
 * `offline_access` is the authorization server's to grant, not the resource's
 * to advertise (MCP authorization, scope selection), so it is left out here.
 */
const SIM_MCP_SCOPES = [OAUTH_API_READ_SCOPE, OAUTH_API_WRITE_SCOPE] as const

function simMcpResource(): OAuthProtectedResource {
  return { resource: getSimMcpUrl(), name: 'Sim', scopes: SIM_MCP_SCOPES }
}

export function simMcpResourceMetadata() {
  return protectedResourceMetadataResponse(simMcpResource())
}

export function withSimMcpAuthChallenge<T extends Response>(response: T): T {
  return withOAuthResourceChallenge(response, simMcpResource())
}
