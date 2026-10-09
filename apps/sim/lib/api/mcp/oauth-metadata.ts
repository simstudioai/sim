import { getSimMcpUrl, type SimMcpProfile } from '@/lib/api/mcp/urls'
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

function simMcpResource(profile: SimMcpProfile): OAuthProtectedResource {
  return { resource: getSimMcpUrl(profile), name: 'Sim', scopes: SIM_MCP_SCOPES }
}

export function simMcpResourceMetadata(profile: SimMcpProfile = 'standard') {
  return protectedResourceMetadataResponse(simMcpResource(profile))
}

export function withSimMcpAuthChallenge<T extends Response>(
  response: T,
  profile: SimMcpProfile = 'standard'
): T {
  return withOAuthResourceChallenge(response, simMcpResource(profile))
}
