export interface McpServerWithStatus {
  id: string
  name: string
  description?: string
  transport: 'http' | 'sse' | 'stdio'
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
  createdAt?: string
  updatedAt?: string
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string
  toolCount?: number
  lastConnected?: string
  totalRequests?: number
  lastUsed?: string
  lastToolsRefresh?: string
  deletedAt?: string
  workspaceId?: string
}

export interface McpServersState {
  servers: McpServerWithStatus[]
  isLoading: boolean
  error: string | null
}

export interface McpServersActions {
  fetchServers: () => Promise<void>
  createServer: (
    config: Omit<
      McpServerWithStatus,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'connectionStatus'
      | 'lastError'
      | 'toolCount'
      | 'lastConnected'
      | 'totalRequests'
      | 'lastUsed'
      | 'lastToolsRefresh'
      | 'deletedAt'
      | 'workspaceId'
    >
  ) => Promise<McpServerWithStatus>
  updateServer: (id: string, updates: Partial<McpServerWithStatus>) => Promise<void>
  deleteServer: (id: string) => Promise<void>
  refreshServer: (id: string) => Promise<void>
  clearError: () => void
  reset: () => void
}

export const initialState: McpServersState = {
  servers: [],
  isLoading: false,
  error: null,
}
