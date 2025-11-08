import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { withOptimisticUpdate } from '@/lib/utils'
import type { CustomToolsState, CustomToolsStore } from './types'

const logger = createLogger('CustomToolsStore')
const API_ENDPOINT = '/api/tools/custom'

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

const initialState: CustomToolsState = {
  tools: [],
  isLoading: false,
  error: null,
}

export const useCustomToolsStore = create<CustomToolsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchTools: async (workspaceId: string) => {
        set({ isLoading: true, error: null })

        try {
          logger.info(`Fetching custom tools for workspace ${workspaceId}`)

          const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(
              errorData.error || `Failed to fetch custom tools: ${response.statusText}`
            )
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

          set({
            tools: validTools,
            isLoading: false,
          })

          logger.info(`Fetched ${validTools.length} custom tools for workspace ${workspaceId}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tools'
          logger.error('Error fetching custom tools:', error)
          set({
            error: errorMessage,
            isLoading: false,
          })
        }
      },

      createTool: async (workspaceId: string, tool) => {
        set({ isLoading: true, error: null })

        try {
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
            throw new ApiError(data.error || 'Failed to create tool', response.status)
          }

          if (!data.data || !Array.isArray(data.data)) {
            throw new Error('Invalid API response: missing tools data')
          }

          set({ tools: data.data, isLoading: false })

          const createdTool = get().tools.find((t) => t.title === tool.title)
          if (!createdTool) {
            throw new Error('Failed to retrieve created tool')
          }

          logger.info(`Created custom tool: ${createdTool.id}`)
          return createdTool
        } catch (error) {
          logger.error('Error creating custom tool:', error)
          set({ isLoading: false })
          throw error
        }
      },

      updateTool: async (workspaceId: string, id: string, updates) => {
        const tool = get().tools.find((t) => t.id === id)
        if (!tool) {
          throw new Error('Tool not found')
        }

        await withOptimisticUpdate({
          getCurrentState: () => get().tools,
          optimisticUpdate: () => {
            set((state) => ({
              tools: state.tools.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      title: updates.title ?? t.title,
                      schema: updates.schema ?? t.schema,
                      code: updates.code ?? t.code,
                    }
                  : t
              ),
              isLoading: true,
              error: null,
            }))
          },
          apiCall: async () => {
            logger.info(`Updating custom tool: ${id} in workspace ${workspaceId}`)

            const response = await fetch(API_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tools: [
                  {
                    id,
                    title: updates.title ?? tool.title,
                    schema: updates.schema ?? tool.schema,
                    code: updates.code ?? tool.code,
                  },
                ],
                workspaceId,
              }),
            })

            const data = await response.json()

            if (!response.ok) {
              throw new ApiError(data.error || 'Failed to update tool', response.status)
            }

            if (!data.data || !Array.isArray(data.data)) {
              throw new Error('Invalid API response: missing tools data')
            }

            set({ tools: data.data })
            logger.info(`Updated custom tool: ${id}`)
          },
          rollback: (originalTools) => {
            set({ tools: originalTools })
          },
          onComplete: () => {
            set({ isLoading: false })
          },
          errorMessage: 'Error updating custom tool',
        })
      },

      deleteTool: async (workspaceId: string | null, id: string) => {
        await withOptimisticUpdate({
          getCurrentState: () => get().tools,
          optimisticUpdate: () => {
            set((state) => ({
              tools: state.tools.filter((tool) => tool.id !== id),
              isLoading: true,
              error: null,
            }))
          },
          apiCall: async () => {
            logger.info(`Deleting custom tool: ${id}`)

            const url = workspaceId
              ? `${API_ENDPOINT}?id=${id}&workspaceId=${workspaceId}`
              : `${API_ENDPOINT}?id=${id}`

            const response = await fetch(url, {
              method: 'DELETE',
            })

            const data = await response.json()

            if (!response.ok) {
              throw new Error(data.error || 'Failed to delete tool')
            }

            logger.info(`Deleted custom tool: ${id}`)
          },
          rollback: (originalTools) => {
            set({ tools: originalTools })
          },
          onComplete: () => {
            set({ isLoading: false })
          },
          errorMessage: 'Error deleting custom tool',
        })
      },

      getTool: (id: string) => {
        return get().tools.find((tool) => tool.id === id)
      },

      getAllTools: () => {
        return get().tools
      },

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: 'custom-tools-store',
    }
  )
)
