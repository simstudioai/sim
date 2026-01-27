import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const logger = createLogger('WorkflowMcpServerQueries')

/**
 * Deployed Workflow type for adding to MCP servers
 */
export interface DeployedWorkflow {
  id: string
  name: string
  description: string | null
  isDeployed: boolean
}

/**
 * Query key factories for Workflow MCP Server queries
 */
export const workflowMcpServerKeys = {
  all: ['workflow-mcp-servers'] as const,
  servers: (workspaceId: string) => [...workflowMcpServerKeys.all, 'servers', workspaceId] as const,
  server: (workspaceId: string, serverId: string) =>
    [...workflowMcpServerKeys.servers(workspaceId), serverId] as const,
  tools: (workspaceId: string, serverId: string) =>
    [...workflowMcpServerKeys.server(workspaceId, serverId), 'tools'] as const,
}

/**
 * Workflow MCP Server Types
 */
export interface WorkflowMcpServer {
  id: string
  workspaceId: string
  createdBy: string
  name: string
  description: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
  toolCount?: number
  toolNames?: string[]
}

export interface WorkflowMcpTool {
  id: string
  serverId: string
  workflowId: string
  toolName: string
  toolDescription: string | null
  parameterSchema: Record<string, unknown>
  createdAt: string
  updatedAt: string
  workflowName?: string
  workflowDescription?: string | null
  isDeployed?: boolean
}

/**
 * Fetch workflow MCP servers for a workspace
 */
async function fetchWorkflowMcpServers(workspaceId: string): Promise<WorkflowMcpServer[]> {
  const response = await fetch(`/api/mcp/workflow-servers?workspaceId=${workspaceId}`)

  if (response.status === 404) {
    return []
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch workflow MCP servers')
  }

  return data.data?.servers || []
}

/**
 * Hook to fetch workflow MCP servers
 */
export function useWorkflowMcpServers(workspaceId: string) {
  return useQuery({
    queryKey: workflowMcpServerKeys.servers(workspaceId),
    queryFn: () => fetchWorkflowMcpServers(workspaceId),
    enabled: !!workspaceId,
    retry: false,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch a single workflow MCP server with its tools
 */
async function fetchWorkflowMcpServer(
  workspaceId: string,
  serverId: string
): Promise<{ server: WorkflowMcpServer; tools: WorkflowMcpTool[] }> {
  const response = await fetch(`/api/mcp/workflow-servers/${serverId}?workspaceId=${workspaceId}`)

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch workflow MCP server')
  }

  return {
    server: data.data?.server,
    tools: data.data?.tools || [],
  }
}

/**
 * Hook to fetch a single workflow MCP server
 */
export function useWorkflowMcpServer(workspaceId: string, serverId: string | null) {
  return useQuery({
    queryKey: workflowMcpServerKeys.server(workspaceId, serverId || ''),
    queryFn: () => fetchWorkflowMcpServer(workspaceId, serverId!),
    enabled: !!workspaceId && !!serverId,
    retry: false,
    staleTime: 30 * 1000,
  })
}

/**
 * Fetch tools for a workflow MCP server
 */
async function fetchWorkflowMcpTools(
  workspaceId: string,
  serverId: string
): Promise<WorkflowMcpTool[]> {
  const response = await fetch(
    `/api/mcp/workflow-servers/${serverId}/tools?workspaceId=${workspaceId}`
  )

  if (response.status === 404) {
    return []
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch workflow MCP tools')
  }

  return data.data?.tools || []
}

/**
 * Hook to fetch tools for a workflow MCP server
 */
export function useWorkflowMcpTools(workspaceId: string, serverId: string | null) {
  return useQuery({
    queryKey: workflowMcpServerKeys.tools(workspaceId, serverId || ''),
    queryFn: () => fetchWorkflowMcpTools(workspaceId, serverId!),
    enabled: !!workspaceId && !!serverId,
    retry: false,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Create workflow MCP server mutation
 */
interface CreateWorkflowMcpServerParams {
  workspaceId: string
  name: string
  description?: string
  isPublic?: boolean
  workflowIds?: string[]
}

export function useCreateWorkflowMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      name,
      description,
      isPublic,
      workflowIds,
    }: CreateWorkflowMcpServerParams) => {
      const response = await fetch('/api/mcp/workflow-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name, description, isPublic, workflowIds }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create workflow MCP server')
      }

      logger.info(`Created workflow MCP server: ${name}`)
      return data.data?.server as WorkflowMcpServer
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.servers(variables.workspaceId),
      })
    },
  })
}

/**
 * Update workflow MCP server mutation
 */
interface UpdateWorkflowMcpServerParams {
  workspaceId: string
  serverId: string
  name?: string
  description?: string
  isPublic?: boolean
}

export function useUpdateWorkflowMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      serverId,
      name,
      description,
      isPublic,
    }: UpdateWorkflowMcpServerParams) => {
      const response = await fetch(
        `/api/mcp/workflow-servers/${serverId}?workspaceId=${workspaceId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, isPublic }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update workflow MCP server')
      }

      logger.info(`Updated workflow MCP server: ${serverId}`)
      return data.data?.server as WorkflowMcpServer
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.servers(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.server(variables.workspaceId, variables.serverId),
      })
    },
  })
}

/**
 * Delete workflow MCP server mutation
 */
interface DeleteWorkflowMcpServerParams {
  workspaceId: string
  serverId: string
}

export function useDeleteWorkflowMcpServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, serverId }: DeleteWorkflowMcpServerParams) => {
      const response = await fetch(
        `/api/mcp/workflow-servers/${serverId}?workspaceId=${workspaceId}`,
        {
          method: 'DELETE',
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete workflow MCP server')
      }

      logger.info(`Deleted workflow MCP server: ${serverId}`)
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.servers(variables.workspaceId),
      })
    },
  })
}

/**
 * Add tool to workflow MCP server mutation
 */
interface AddWorkflowMcpToolParams {
  workspaceId: string
  serverId: string
  workflowId: string
  toolName?: string
  toolDescription?: string
  parameterSchema?: Record<string, unknown>
}

export function useAddWorkflowMcpTool() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      serverId,
      workflowId,
      toolName,
      toolDescription,
      parameterSchema,
    }: AddWorkflowMcpToolParams) => {
      const response = await fetch(
        `/api/mcp/workflow-servers/${serverId}/tools?workspaceId=${workspaceId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId, toolName, toolDescription, parameterSchema }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add tool to workflow MCP server')
      }

      logger.info(`Added tool to workflow MCP server: ${serverId}`)
      return data.data?.tool as WorkflowMcpTool
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.servers(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.server(variables.workspaceId, variables.serverId),
      })
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.tools(variables.workspaceId, variables.serverId),
      })
    },
  })
}

/**
 * Update tool mutation
 */
interface UpdateWorkflowMcpToolParams {
  workspaceId: string
  serverId: string
  toolId: string
  toolName?: string
  toolDescription?: string
  parameterSchema?: Record<string, unknown>
}

export function useUpdateWorkflowMcpTool() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      serverId,
      toolId,
      ...updates
    }: UpdateWorkflowMcpToolParams) => {
      const response = await fetch(
        `/api/mcp/workflow-servers/${serverId}/tools/${toolId}?workspaceId=${workspaceId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update tool')
      }

      logger.info(`Updated tool ${toolId} in workflow MCP server: ${serverId}`)
      return data.data?.tool as WorkflowMcpTool
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.tools(variables.workspaceId, variables.serverId),
      })
    },
  })
}

/**
 * Delete tool mutation
 */
interface DeleteWorkflowMcpToolParams {
  workspaceId: string
  serverId: string
  toolId: string
}

export function useDeleteWorkflowMcpTool() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, serverId, toolId }: DeleteWorkflowMcpToolParams) => {
      const response = await fetch(
        `/api/mcp/workflow-servers/${serverId}/tools/${toolId}?workspaceId=${workspaceId}`,
        {
          method: 'DELETE',
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete tool')
      }

      logger.info(`Deleted tool ${toolId} from workflow MCP server: ${serverId}`)
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.servers(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.server(variables.workspaceId, variables.serverId),
      })
      queryClient.invalidateQueries({
        queryKey: workflowMcpServerKeys.tools(variables.workspaceId, variables.serverId),
      })
    },
  })
}

/**
 * Fetch deployed workflows for a workspace
 */
async function fetchDeployedWorkflows(workspaceId: string): Promise<DeployedWorkflow[]> {
  const response = await fetch(`/api/workflows?workspaceId=${workspaceId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }

  const { data }: { data: any[] } = await response.json()

  return data
    .filter((w) => w.isDeployed)
    .map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      isDeployed: w.isDeployed,
    }))
}

/**
 * Hook to fetch deployed workflows for a workspace
 */
export function useDeployedWorkflows(workspaceId: string) {
  return useQuery({
    queryKey: ['deployed-workflows', workspaceId],
    queryFn: () => fetchDeployedWorkflows(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}
