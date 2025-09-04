import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { initialState, type McpServersActions, type McpServersState } from './types'

const logger = createLogger('McpServersStore')

export const useMcpServersStore = create<McpServersState & McpServersActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchServers: async () => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch('/api/mcp/servers')
          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch servers')
          }

          set({ servers: data.data?.servers || [], isLoading: false })
          logger.info(`Fetched ${data.data?.servers?.length || 0} MCP servers`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch servers'
          logger.error('Failed to fetch MCP servers:', error)
          set({ error: errorMessage, isLoading: false })
        }
      },

      createServer: async (config) => {
        set({ isLoading: true, error: null })

        try {
          const serverData = {
            ...config,
            id: `mcp-${Date.now()}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }

          const response = await fetch('/api/mcp/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverData),
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to create server')
          }

          const newServer = { ...serverData, connectionStatus: 'connected' as const }
          set((state) => ({
            servers: [...state.servers, newServer],
            isLoading: false,
          }))

          logger.info(`Created MCP server: ${config.name}`)
          return newServer
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create server'
          logger.error('Failed to create MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      updateServer: async (id, updates) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(`/api/mcp/servers/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...updates,
              updatedAt: new Date().toISOString(),
            }),
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to update server')
          }

          set((state) => ({
            servers: state.servers.map((server) =>
              server.id === id
                ? { ...server, ...updates, updatedAt: new Date().toISOString() }
                : server
            ),
            isLoading: false,
          }))

          logger.info(`Updated MCP server: ${id}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update server'
          logger.error('Failed to update MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      deleteServer: async (id) => {
        set({ isLoading: true, error: null })

        try {
          const response = await fetch(`/api/mcp/servers?serverId=${id}`, {
            method: 'DELETE',
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to delete server')
          }

          set((state) => ({
            servers: state.servers.filter((server) => server.id !== id),
            isLoading: false,
          }))

          logger.info(`Deleted MCP server: ${id}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete server'
          logger.error('Failed to delete MCP server:', error)
          set({ error: errorMessage, isLoading: false })
          throw error
        }
      },

      refreshServer: async (id) => {
        const server = get().servers.find((s) => s.id === id)
        if (!server) return

        try {
          const response = await fetch(`/api/mcp/servers/${id}/refresh`, {
            method: 'POST',
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to refresh server')
          }

          const refreshedData = await response.json()

          set((state) => ({
            servers: state.servers.map((s) =>
              s.id === id
                ? {
                    ...s,
                    connectionStatus: refreshedData.status || 'disconnected',
                    toolCount: refreshedData.toolCount || 0,
                    lastConnected: refreshedData.lastConnected,
                    lastError: refreshedData.error,
                    lastToolsRefresh: new Date().toISOString(),
                  }
                : s
            ),
          }))

          logger.info(`Refreshed MCP server: ${id}`)
        } catch (error) {
          logger.error(`Failed to refresh MCP server ${id}:`, error)

          set((state) => ({
            servers: state.servers.map((s) =>
              s.id === id
                ? {
                    ...s,
                    connectionStatus: 'error',
                    lastError: error instanceof Error ? error.message : 'Refresh failed',
                  }
                : s
            ),
          }))
        }
      },

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: 'mcp-servers-store',
    }
  )
)

export const useIsConnectedServer = (serverId: string) => {
  return useMcpServersStore(
    (state) => state.servers.find((s) => s.id === serverId)?.connectionStatus === 'connected'
  )
}

export const useServerToolCount = (serverId: string) => {
  return useMcpServersStore((state) => state.servers.find((s) => s.id === serverId)?.toolCount || 0)
}

export const useEnabledServers = () => {
  return useMcpServersStore((state) => state.servers.filter((s) => s.enabled && !s.deletedAt))
}
