import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface CustomToolSchema {
  type: string
  function: {
    name: string
    description?: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export interface CustomToolDefinition {
  id: string
  title: string
  schema: CustomToolSchema
  code: string
  createdAt: string
  updatedAt?: string
}

interface CustomToolsStore {
  tools: Record<string, CustomToolDefinition>
  addTool: (tool: Omit<CustomToolDefinition, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateTool: (
    id: string,
    updates: Partial<Omit<CustomToolDefinition, 'id' | 'createdAt' | 'updatedAt'>>
  ) => boolean
  removeTool: (id: string) => void
  getTool: (id: string) => CustomToolDefinition | undefined
  getAllTools: () => CustomToolDefinition[]
}

export const useCustomToolsStore = create<CustomToolsStore>()(
  devtools(
    persist(
      (set, get) => ({
        tools: {},

        addTool: (tool) => {
          const id = crypto.randomUUID()
          const newTool = {
            ...tool,
            id,
            createdAt: new Date().toISOString(),
          }

          set((state) => ({
            tools: {
              ...state.tools,
              [id]: newTool,
            },
          }))

          return id
        },

        updateTool: (id, updates) => {
          const tool = get().tools[id]
          if (!tool) return false

          const updatedTool = {
            ...tool,
            ...updates,
            updatedAt: new Date().toISOString(),
          }

          set((state) => ({
            tools: {
              ...state.tools,
              [id]: updatedTool,
            },
          }))

          return true
        },

        removeTool: (id) => {
          set((state) => {
            const newTools = { ...state.tools }
            delete newTools[id]
            return { tools: newTools }
          })
        },

        getTool: (id) => {
          return get().tools[id]
        },

        getAllTools: () => {
          return Object.values(get().tools)
        },
      }),
      {
        name: 'custom-tools-store',
      }
    )
  )
)
