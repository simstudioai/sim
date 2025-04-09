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

export interface CustomToolsStore {
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
