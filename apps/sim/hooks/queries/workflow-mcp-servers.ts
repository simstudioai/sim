import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  createWorkflowMcpServerContract,
  createWorkflowMcpToolContract,
  type DeployedWorkflow,
  deleteWorkflowMcpServerContract,
  deleteWorkflowMcpToolContract,
  getWorkflowMcpServerContract,
  listWorkflowMcpDeployedWorkflowsContract,
  listWorkflowMcpServersContract,
  listWorkflowMcpToolsContract,
  updateWorkflowMcpServerContract,
  updateWorkflowMcpToolContract,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/lib/api/contracts/workflow-mcp-servers'

const logger = createLogger('WorkflowMcpServerQueries')

export type { DeployedWorkflow }

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
  deployedWorkflows: (workspaceId: string) =>
    [...workflowMcpServerKeys.all, 'deployed-workflows', workspaceId] as const,
}

export type { WorkflowMcpServer, WorkflowMcpTool }

/**
 * Fetch workflow MCP servers for a workspace
 */
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

/**
 * Hook to fetch workflow MCP servers
 */
export function useWorkflowMcpServers(workspaceId: string) {
  return useQuery({
    queryKey: workflowMcpServerKeys.servers(workspaceId),
    queryFn: ({ signal }) => fetchWorkflowMcpServers(workspaceId, signal),
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
  serverId: string,
  signal?: AbortSignal
): Promise<{ server: WorkflowMcpServer; tools: WorkflowMcpTool[] }> {
  const data = await requestJson(getWorkflowMcpServerContract, {
    params: { id: serverId },
    query: { workspaceId },
    signal,
  })

  return {
    server: data.data.server,
    tools: data.data.tools,
  }
}

/**
 * Hook to fetch a single workflow MCP server
 */
export function useWorkflowMcpServer(workspaceId: string, serverId: string | null) {
  return useQuery({
    queryKey: workflowMcpServerKeys.server(workspaceId, serverId || ''),
    queryFn: ({ signal }) => fetchWorkflowMcpServer(workspaceId, serverId!, signal),
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
  serverId: string,
  signal?: AbortSignal
): Promise<WorkflowMcpTool[]> {
  try {
    const data = await requestJson(listWorkflowMcpToolsContract, {
      params: { id: serverId },
      query: { workspaceId },
      signal,
    })
    return data.data.tools
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return []
    }
    throw error
  }
}

/**
 * Hook to fetch tools for a workflow MCP server
 */
export function useWorkflowMcpTools(workspaceId: string, serverId: string | null) {
  return useQuery({
    queryKey: workflowMcpServerKeys.tools(workspaceId, serverId || ''),
    queryFn: ({ signal }) => fetchWorkflowMcpTools(workspaceId, serverId!, signal),
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
      const data = await requestJson(createWorkflowMcpServerContract, {
        body: { workspaceId, name, description, isPublic, workflowIds },
      })

      logger.info(`Created workflow MCP server: ${name}`)
      return data.data.server
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
      const data = await requestJson(updateWorkflowMcpServerContract, {
        params: { id: serverId },
        query: { workspaceId },
        body: { name, description, isPublic },
      })

      logger.info(`Updated workflow MCP server: ${serverId}`)
      return data.data.server
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
      const data = await requestJson(deleteWorkflowMcpServerContract, {
        params: { id: serverId },
        query: { workspaceId },
      })

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
      const data = await requestJson(createWorkflowMcpToolContract, {
        params: { id: serverId },
        query: { workspaceId },
        body: { workflowId, toolName, toolDescription, parameterSchema },
      })

      logger.info(`Added tool to workflow MCP server: ${serverId}`)
      return data.data.tool
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
      const data = await requestJson(updateWorkflowMcpToolContract, {
        params: { id: serverId, toolId },
        query: { workspaceId },
        body: updates,
      })

      logger.info(`Updated tool ${toolId} in workflow MCP server: ${serverId}`)
      return data.data.tool
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
      const data = await requestJson(deleteWorkflowMcpToolContract, {
        params: { id: serverId, toolId },
        query: { workspaceId },
      })

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
async function fetchDeployedWorkflows(
  workspaceId: string,
  signal?: AbortSignal
): Promise<DeployedWorkflow[]> {
  const { data } = await requestJson(listWorkflowMcpDeployedWorkflowsContract, {
    query: { workspaceId },
    signal,
  })

  return data
    .filter((w) => w.isDeployed)
    .map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description ?? null,
      isDeployed: w.isDeployed,
    }))
}

/**
 * Hook to fetch deployed workflows for a workspace
 */
export function useDeployedWorkflows(workspaceId: string) {
  return useQuery({
    queryKey: workflowMcpServerKeys.deployedWorkflows(workspaceId),
    queryFn: ({ signal }) => fetchDeployedWorkflows(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}
