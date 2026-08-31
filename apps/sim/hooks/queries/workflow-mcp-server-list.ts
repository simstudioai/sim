import { queryOptions } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  listWorkflowMcpServersContract,
  type WorkflowMcpServer,
} from '@/lib/api/contracts/workflow-mcp-servers'

export const workflowMcpServerKeys = {
  all: ['workflow-mcp-servers'] as const,
  serverLists: () => [...workflowMcpServerKeys.all, 'server-list'] as const,
  servers: (workspaceId: string) => [...workflowMcpServerKeys.serverLists(), workspaceId] as const,
  details: () => [...workflowMcpServerKeys.all, 'detail'] as const,
  server: (workspaceId: string, serverId: string) =>
    [...workflowMcpServerKeys.details(), workspaceId, serverId] as const,
  tools: (workspaceId: string, serverId: string) =>
    [...workflowMcpServerKeys.server(workspaceId, serverId), 'tools'] as const,
  deployedWorkflowLists: () => [...workflowMcpServerKeys.all, 'deployed-workflow-list'] as const,
  deployedWorkflows: (workspaceId: string) =>
    [...workflowMcpServerKeys.deployedWorkflowLists(), workspaceId] as const,
}

export const WORKFLOW_MCP_SERVERS_LIST_STALE_TIME = 60 * 1000

async function fetchWorkflowMcpServers(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkflowMcpServer[]> {
  try {
    const data = await requestJson(listWorkflowMcpServersContract, {
      query: { workspaceId },
      signal,
    })
    return data.data.servers
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return []
    }
    throw error
  }
}

export function workflowMcpServersQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workflowMcpServerKeys.servers(workspaceId),
    queryFn: ({ signal }) => fetchWorkflowMcpServers(workspaceId, signal),
    retry: false,
    retryOnMount: true,
    staleTime: WORKFLOW_MCP_SERVERS_LIST_STALE_TIME,
  })
}
