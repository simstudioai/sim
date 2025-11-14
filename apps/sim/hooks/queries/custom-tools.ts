import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { useCustomToolsStore } from '@/stores/custom-tools/store'

const logger = createLogger('CustomToolsQueries')
const API_ENDPOINT = '/api/tools/custom'

/**
 * Query key factories for custom tools queries
 */
export const customToolsKeys = {
  all: ['customTools'] as const,
  lists: () => [...customToolsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...customToolsKeys.lists(), workspaceId] as const,
  detail: (toolId: string) => [...customToolsKeys.all, 'detail', toolId] as const,
}

/**
 * Custom Tool Types
 */
export interface CustomToolSchema {
  function?: {
    name?: string
    description?: string
    parameters?: any
  }
}

export interface CustomTool {
  id: string
  title: string
  schema?: CustomToolSchema
  code: string
  workspaceId?: string
  userId?: string
  createdAt?: string
  updatedAt?: string
}

function syncCustomToolsToStore(tools: CustomTool[]) {
  useCustomToolsStore.getState().setTools(tools)
}

/**
 * Fetch custom tools for a workspace
 */
async function fetchCustomTools(workspaceId: string): Promise<CustomTool[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch custom tools: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  // Filter and validate tools
  const validTools = data.filter((tool, index) => {
    if (!tool || typeof tool !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: not an object`)
      return false
    }
    if (!tool.id || typeof tool.id !== 'string') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid id`)
      return false
    }
    if (!tool.title || typeof tool.title !== 'string') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid title`)
      return false
    }
    if (!tool.schema || typeof tool.schema !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid schema`)
      return false
    }
    if (!tool.code || typeof tool.code !== 'string') {
      logger.warn(`Tool at index ${index} missing code field, defaulting to empty string`)
      tool.code = ''
    }
    return true
  })

  return validTools
}

/**
 * Hook to fetch custom tools
 */
export function useCustomTools(workspaceId: string) {
  const query = useQuery({
    queryKey: customToolsKeys.list(workspaceId),
    queryFn: () => fetchCustomTools(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000, // 1 minute - tools don't change frequently
    placeholderData: keepPreviousData,
  })

  if (query.data) {
    syncCustomToolsToStore(query.data)
  }

  return query
}

/**
 * Create custom tool mutation
 */
interface CreateCustomToolParams {
  workspaceId: string
  tool: {
    title: string
    schema: CustomToolSchema
    code: string
  }
}

export function useCreateCustomTool() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, tool }: CreateCustomToolParams) => {
      logger.info(`Creating custom tool: ${tool.title} in workspace ${workspaceId}`)

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: [
            {
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
            },
          ],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create tool')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing tools data')
      }

      logger.info(`Created custom tool: ${tool.title}`)
      return data.data
    },
    onSuccess: (_data, variables) => {
      // Invalidate tools list for the workspace
      queryClient.invalidateQueries({ queryKey: customToolsKeys.list(variables.workspaceId) })
    },
  })
}

/**
 * Update custom tool mutation
 */
interface UpdateCustomToolParams {
  workspaceId: string
  toolId: string
  updates: {
    title?: string
    schema?: CustomToolSchema
    code?: string
  }
}

export function useUpdateCustomTool() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, toolId, updates }: UpdateCustomToolParams) => {
      logger.info(`Updating custom tool: ${toolId} in workspace ${workspaceId}`)

      // Get the current tool to merge with updates
      const currentTools = queryClient.getQueryData<CustomTool[]>(customToolsKeys.list(workspaceId))
      const currentTool = currentTools?.find((t) => t.id === toolId)

      if (!currentTool) {
        throw new Error('Tool not found')
      }

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: [
            {
              id: toolId,
              title: updates.title ?? currentTool.title,
              schema: updates.schema ?? currentTool.schema,
              code: updates.code ?? currentTool.code,
            },
          ],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update tool')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing tools data')
      }

      logger.info(`Updated custom tool: ${toolId}`)
      return data.data
    },
    onMutate: async ({ workspaceId, toolId, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: customToolsKeys.list(workspaceId) })

      // Snapshot the previous value
      const previousTools = queryClient.getQueryData<CustomTool[]>(
        customToolsKeys.list(workspaceId)
      )

      // Optimistically update to the new value
      if (previousTools) {
        queryClient.setQueryData<CustomTool[]>(
          customToolsKeys.list(workspaceId),
          previousTools.map((tool) =>
            tool.id === toolId
              ? {
                  ...tool,
                  title: updates.title ?? tool.title,
                  schema: updates.schema ?? tool.schema,
                  code: updates.code ?? tool.code,
                }
              : tool
          )
        )
      }

      return { previousTools }
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previousTools) {
        queryClient.setQueryData(customToolsKeys.list(variables.workspaceId), context.previousTools)
      }
    },
    onSettled: (_data, _error, variables) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: customToolsKeys.list(variables.workspaceId) })
    },
  })
}

/**
 * Delete custom tool mutation
 */
interface DeleteCustomToolParams {
  workspaceId: string | null
  toolId: string
}

export function useDeleteCustomTool() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, toolId }: DeleteCustomToolParams) => {
      logger.info(`Deleting custom tool: ${toolId}`)

      const url = workspaceId
        ? `${API_ENDPOINT}?id=${toolId}&workspaceId=${workspaceId}`
        : `${API_ENDPOINT}?id=${toolId}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete tool')
      }

      logger.info(`Deleted custom tool: ${toolId}`)
      return data
    },
    onMutate: async ({ workspaceId, toolId }) => {
      if (!workspaceId) return

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: customToolsKeys.list(workspaceId) })

      // Snapshot the previous value
      const previousTools = queryClient.getQueryData<CustomTool[]>(
        customToolsKeys.list(workspaceId)
      )

      // Optimistically update to the new value
      if (previousTools) {
        queryClient.setQueryData<CustomTool[]>(
          customToolsKeys.list(workspaceId),
          previousTools.filter((tool) => tool.id !== toolId)
        )
      }

      return { previousTools, workspaceId }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousTools && context?.workspaceId) {
        queryClient.setQueryData(customToolsKeys.list(context.workspaceId), context.previousTools)
      }
    },
    onSettled: (_data, _error, variables) => {
      // Always refetch after error or success
      if (variables.workspaceId) {
        queryClient.invalidateQueries({ queryKey: customToolsKeys.list(variables.workspaceId) })
      }
    },
  })
}
