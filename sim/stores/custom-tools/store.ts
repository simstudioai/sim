import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { CustomToolsStore } from './types'

const logger = createLogger('CustomToolsStore')
const API_ENDPOINT = '/api/tools/custom'

export const useCustomToolsStore = create<CustomToolsStore>()(
  devtools(
    persist(
      (set, get) => ({
        tools: {},
        isLoading: false,
        error: null,

        // Load tools from server
        loadCustomTools: async () => {
          try {
            set({ isLoading: true, error: null })
            logger.info('Loading custom tools from server')
            
            const response = await fetch(API_ENDPOINT)
            
            if (!response.ok) {
              throw new Error(`Failed to load custom tools: ${response.statusText}`)
            }
            
            const { data } = await response.json()
            
            if (!Array.isArray(data)) {
              throw new Error('Invalid response format')
            }
            
            // Validate each tool object's structure before processing
            data.forEach((tool, index) => {
              if (!tool || typeof tool !== 'object') {
                throw new Error(`Invalid tool format at index ${index}: not an object`)
              }
              if (!tool.id || typeof tool.id !== 'string') {
                throw new Error(`Invalid tool format at index ${index}: missing or invalid id`)
              }
              if (!tool.title || typeof tool.title !== 'string') {
                throw new Error(`Invalid tool format at index ${index}: missing or invalid title`)
              }
              if (!tool.schema || typeof tool.schema !== 'object') {
                throw new Error(`Invalid tool format at index ${index}: missing or invalid schema`)
              }
              if (!tool.code || typeof tool.code !== 'string') {
                throw new Error(`Invalid tool format at index ${index}: missing or invalid code`)
              }
            })
            
            // Transform to local format and set
            const transformedTools = data.reduce(
              (acc, tool) => ({
                ...acc,
                [tool.id]: tool
              }),
              {}
            )
            
            logger.info(`Loaded ${data.length} custom tools from server`)
            
            // Log details of loaded tools for debugging
            if (data.length > 0) {
              logger.info('Custom tools loaded:', data.map(tool => ({
                id: tool.id,
                title: tool.title,
                functionName: tool.schema?.function?.name || 'unknown'
              })))
            }
            
            set({
              tools: transformedTools,
              isLoading: false
            })
          } catch (error) {
            logger.error('Error loading custom tools:', error)
            set({
              error: error instanceof Error ? error.message : 'Unknown error',
              isLoading: false
            })
            
            // Add a delay before reloading to prevent race conditions
            setTimeout(() => {
              // Reload from server to ensure consistency
              get().loadCustomTools()
            }, 500)
          }
        },

        // Save tools to server
        sync: async () => {
          try {
            set({ isLoading: true, error: null })
            
            const tools = Object.values(get().tools)
            logger.info(`Syncing ${tools.length} custom tools with server`)
            
            // Log details of tools being synced for debugging
            if (tools.length > 0) {
              logger.info('Custom tools to sync:', tools.map(tool => ({
                id: tool.id,
                title: tool.title,
                functionName: tool.schema?.function?.name || 'unknown'
              })))
            }
            
            const response = await fetch(API_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tools })
            })
            
            if (!response.ok) {
              // Try to get more detailed error information
              try {
                const errorData = await response.json();
                throw new Error(`Failed to sync custom tools: ${response.statusText}. ${errorData.error || ''}`)
              } catch (parseError) {
                throw new Error(`Failed to sync custom tools: ${response.statusText}`)
              }
            }
            
            set({ isLoading: false })
            logger.info('Successfully synced custom tools with server')
            
            // Load from server to ensure consistency even after successful sync
            get().loadCustomTools()
          } catch (error) {
            logger.error('Error syncing custom tools:', error)
            set({
              error: error instanceof Error ? error.message : 'Unknown error',
              isLoading: false
            })
            
            // Add a delay before reloading to prevent race conditions
            setTimeout(() => {
              // Reload from server to ensure consistency
              get().loadCustomTools()
            }, 500)
          }
        },

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
          
          // Sync with server
          get().sync().catch(error => {
            logger.error('Error syncing after adding tool:', error)
          })

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
          
          // Sync with server
          get().sync().catch(error => {
            logger.error('Error syncing after updating tool:', error)
          })

          return true
        },

        removeTool: (id) => {
          set((state) => {
            const newTools = { ...state.tools }
            delete newTools[id]
            return { tools: newTools }
          })
          
          // Sync with server
          get().sync().catch(error => {
            logger.error('Error syncing after removing tool:', error)
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
        onRehydrateStorage: () => {
          return (state) => {
            // We'll load via the central initialization system in stores/index.ts
            // No need for a setTimeout here
            logger.info('Store rehydrated from localStorage')
          }
        }
      }
    )
  )
)
