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
}

export interface CustomToolsActions {
  setTools: (tools: CustomToolDefinition[]) => void
  getTool: (id: string) => CustomToolDefinition | undefined
  getAllTools: () => CustomToolDefinition[]
  reset: () => void
}

export interface CustomToolsStore extends CustomToolsState, CustomToolsActions {}
