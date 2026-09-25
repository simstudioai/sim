import {
  type OAuthProtectedResource,
  protectedResourceMetadataResponse,
  withOAuthResourceChallenge,
} from '@/lib/auth/oauth-protected-resource'
import { OAUTH_API_READ_SCOPE, OAUTH_API_WRITE_SCOPE } from '@/lib/auth/oauth-provider'
import { buildWorkflowMcpServerUrl } from '@/lib/mcp/urls'

/**
 * Listing tools needs `api:read`; calling one runs a workflow, so it needs
 * `api:write`. `offline_access` is the authorization server's to grant.
 */
const WORKFLOW_MCP_SCOPES = [OAUTH_API_READ_SCOPE, OAUTH_API_WRITE_SCOPE] as const

function workflowMcpResource(serverId: string): OAuthProtectedResource {
  return {
    resource: buildWorkflowMcpServerUrl(serverId),
    name: 'Sim workflow MCP server',
    scopes: WORKFLOW_MCP_SCOPES,
  }
}

export function workflowMcpResourceMetadata(serverId: string) {
  return protectedResourceMetadataResponse(workflowMcpResource(serverId))
}

export function withWorkflowMcpAuthChallenge<T extends Response>(response: T, serverId: string): T {
  return withOAuthResourceChallenge(response, workflowMcpResource(serverId))
}
