import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import type { CustomToolDefinition, CustomToolSchema } from '@/stores/custom-tools/types'

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

export type CustomTool = CustomToolDefinition

type ApiCustomTool = Partial<CustomToolDefinition> & {
  id: string
  title: string
  schema: Partial<CustomToolSchema> & {
    function?: Partial<CustomToolSchema['function']> & {
      parameters?: Partial<CustomToolSchema['function']['parameters']>
    }
  }
  code?: string
}

function normalizeCustomTool(tool: ApiCustomTool, workspaceId: string): CustomToolDefinition {
  const fallbackName = tool.schema.function?.name || tool.id
  const parameters = tool.schema.function?.parameters ?? {
    type: 'object',
    properties: {},
  }

  return {
    id: tool.id,
    title: tool.title,
    code: typeof tool.code === 'string' ? tool.code : '',
    workspaceId: tool.workspaceId ?? workspaceId ?? null,
    userId: tool.userId ?? null,
    createdAt:
      typeof tool.createdAt === 'string'
        ? tool.createdAt
        : tool.updatedAt && typeof tool.updatedAt === 'string'
          ? tool.updatedAt
          : new Date().toISOString(),
    updatedAt: typeof tool.updatedAt === 'string' ? tool.updatedAt : undefined,
    schema: {
      type: tool.schema.type ?? 'function',
      function: {
        name: fallbackName,
        description: tool.schema.function?.description,
        parameters: {
          type: parameters.type ?? 'object',
          properties: parameters.properties ?? {},
          required: parameters.required,
        },
      },
    },
  }
}

function syncCustomToolsToStore(tools: CustomToolDefinition[]) {
  useCustomToolsStore.getState().setTools(tools)
}

/**
 * Fetch custom tools for a workspace
 */
async function fetchCustomTools(workspaceId: string): Promise<CustomToolDefinition[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch custom tools: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  const normalizedTools: CustomToolDefinition[] = []

  data.forEach((tool, index) => {
    if (!tool || typeof tool !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: not an object`)
      return
    }
    if (!tool.id || typeof tool.id !== 'string') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid id`)
      return
    }
    if (!tool.title || typeof tool.title !== 'string') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid title`)
      return
    }
    if (!tool.schema || typeof tool.schema !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid schema`)
      return
    }
    if (!tool.schema.function || typeof tool.schema.function !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: missing function schema`)
      return
    }

    const apiTool: ApiCustomTool = {
      id: tool.id,
      title: tool.title,
      schema: tool.schema,
      code: typeof tool.code === 'string' ? tool.code : '',
      workspaceId: tool.workspaceId ?? null,
      userId: tool.userId ?? null,
      createdAt: tool.createdAt ?? undefined,
      updatedAt: tool.updatedAt ?? undefined,
    }

    try {
      normalizedTools.push(normalizeCustomTool(apiTool, workspaceId))
    } catch (error) {
      logger.warn(`Failed to normalize custom tool at index ${index}`, { error })
    }
  })

  return normalizedTools
}

/**
 * Hook to fetch custom tools
 */
export function useCustomTools(workspaceId: string) {
  const query = useQuery<CustomToolDefinition[]>({
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

      const currentTools = queryClient.getQueryData<CustomToolDefinition[]>(
        customToolsKeys.list(workspaceId)
      )
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
      await queryClient.cancelQueries({ queryKey: customToolsKeys.list(workspaceId) })

      const previousTools = queryClient.getQueryData<CustomToolDefinition[]>(
        customToolsKeys.list(workspaceId)
      )

      if (previousTools) {
        queryClient.setQueryData<CustomToolDefinition[]>(
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
      if (context?.previousTools) {
        queryClient.setQueryData(customToolsKeys.list(variables.workspaceId), context.previousTools)
      }
    },
    onSettled: (_data, _error, variables) => {
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

      await queryClient.cancelQueries({ queryKey: customToolsKeys.list(workspaceId) })

      const previousTools = queryClient.getQueryData<CustomToolDefinition[]>(
        customToolsKeys.list(workspaceId)
      )

      if (previousTools) {
        queryClient.setQueryData<CustomToolDefinition[]>(
          customToolsKeys.list(workspaceId),
          previousTools.filter((tool) => tool.id !== toolId)
        )
      }

      return { previousTools, workspaceId }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTools && context?.workspaceId) {
        queryClient.setQueryData(customToolsKeys.list(context.workspaceId), context.previousTools)
      }
    },
    onSettled: (_data, _error, variables) => {
      if (variables.workspaceId) {
        queryClient.invalidateQueries({ queryKey: customToolsKeys.list(variables.workspaceId) })
      }
    },
  })
}
