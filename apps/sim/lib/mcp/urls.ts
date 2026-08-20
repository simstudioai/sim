import { getBaseUrl } from '@/lib/core/utils/urls'

/**
 * The endpoint an MCP client connects to for a workspace-published server.
 *
 * Shared by the Copilot deploy handler and the v2 surface so the two cannot
 * publish different URLs for the same server.
 */
export function buildWorkflowMcpServerUrl(serverId: string): string {
  return `${getBaseUrl()}/api/mcp/serve/${serverId}`
}

/**
 * The Sim execution endpoint a deployed workflow is called through, and the one
 * a published MCP tool routes to.
 *
 * Lives here rather than beside {@link getBaseUrl} in `lib/core/utils/urls`
 * because that module is replaced wholesale by the shared test mock, so an
 * export added there is `undefined` in every suite until the fixture mirrors it.
 */
export function buildWorkflowMcpApiEndpoint(workflowId: string): string {
  return `${getBaseUrl()}/api/v2/workflows/${workflowId}/execute`
}
