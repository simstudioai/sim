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
  workspaceId: string | null
  userId: string | null
  title: string
  schema: CustomToolSchema
  code: string
  createdAt: string
  updatedAt?: string
}

export interface CustomToolsState {
  tools: CustomToolDefinition[]
  isLoading: boolean
  error: string | null
}

export interface CustomToolsActions {
  fetchTools: (workspaceId: string) => Promise<void>
  createTool: (
    workspaceId: string,
    tool: Omit<CustomToolDefinition, 'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'>
  ) => Promise<CustomToolDefinition>
  updateTool: (
    workspaceId: string,
    id: string,
    updates: Partial<
      Omit<CustomToolDefinition, 'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'>
    >
  ) => Promise<void>
  deleteTool: (workspaceId: string | null, id: string) => Promise<void>
  getTool: (id: string) => CustomToolDefinition | undefined
  getAllTools: () => CustomToolDefinition[]
  clearError: () => void
  reset: () => void
}

export interface CustomToolsStore extends CustomToolsState, CustomToolsActions {}
