import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { CustomToolsStore } from './types'

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
