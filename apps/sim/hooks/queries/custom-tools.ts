import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteCustomToolContract,
  listCustomToolsContract,
  upsertCustomToolsContract,
} from '@/lib/api/contracts/tools/custom'
import { customToolsKeys } from '@/hooks/queries/utils/custom-tool-keys'

const logger = createLogger('CustomToolsQueries')

export interface CustomToolSchema {
  [key: string]: unknown
  type: 'function'
  function: {
    [key: string]: unknown
    name: string
    description?: string
    parameters: {
      [key: string]: unknown
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export interface CustomToolDefinition {
  id: string
  workspaceId: string | null
  userId: string | null
  title: string
  schema: CustomToolSchema
  code: string
  createdAt: string
  updatedAt?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/**
 * Fetch custom tools for a workspace
 */
async function fetchCustomTools(
  workspaceId: string,
  signal?: AbortSignal
): Promise<CustomToolDefinition[]> {
  const { data } = await requestJson(listCustomToolsContract, {
    query: { workspaceId },
    signal,
  })

  const normalizedTools: CustomToolDefinition[] = []

  data.forEach((tool, index) => {
    if (!isRecord(tool)) {
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
    if (!isRecord(tool.schema)) {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid schema`)
      return
    }
    if (!isRecord(tool.schema.function)) {
      logger.warn(`Skipping invalid tool at index ${index}: missing function schema`)
      return
    }

    const functionSchema = tool.schema.function
    const parameters = isRecord(functionSchema.parameters) ? functionSchema.parameters : {}
    const properties = isRecord(parameters.properties) ? parameters.properties : {}
    const required = Array.isArray(parameters.required)
      ? parameters.required.filter((value): value is string => typeof value === 'string')
      : undefined

    const apiTool: ApiCustomTool = {
      id: tool.id,
      title: tool.title,
      schema: {
        type: 'function',
        function: {
          name: typeof functionSchema.name === 'string' ? functionSchema.name : tool.id,
          description:
            typeof functionSchema.description === 'string' ? functionSchema.description : undefined,
          parameters: {
            type: typeof parameters.type === 'string' ? parameters.type : 'object',
            properties,
            required,
          },
        },
      },
      code: typeof tool.code === 'string' ? tool.code : '',
      workspaceId: typeof tool.workspaceId === 'string' ? tool.workspaceId : null,
      userId: typeof tool.userId === 'string' ? tool.userId : null,
      createdAt: typeof tool.createdAt === 'string' ? tool.createdAt : undefined,
      updatedAt: typeof tool.updatedAt === 'string' ? tool.updatedAt : undefined,
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
  return useQuery<CustomToolDefinition[]>({
    queryKey: customToolsKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchCustomTools(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 60 * 1000, // 1 minute - tools don't change frequently
    placeholderData: keepPreviousData,
  })
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

      const data = await requestJson(upsertCustomToolsContract, {
        body: {
          tools: [
            {
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
            },
          ],
          workspaceId,
        },
      })

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing tools data')
      }

      logger.info(`Created custom tool: ${tool.title}`)
      return data.data as CustomToolDefinition[]
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

      const data = await requestJson(upsertCustomToolsContract, {
        body: {
          tools: [
            {
              id: toolId,
              title: updates.title ?? currentTool.title,
              schema: updates.schema ?? currentTool.schema,
              code: updates.code ?? currentTool.code,
            },
          ],
          workspaceId,
        },
      })

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing tools data')
      }

      logger.info(`Updated custom tool: ${toolId}`)
      return data.data as CustomToolDefinition[]
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

      const data = await requestJson(deleteCustomToolContract, {
        query: { id: toolId, workspaceId: workspaceId ?? undefined },
      })

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
