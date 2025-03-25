export type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export interface Variable {
  id: string
  workflowId: string
  name: string
  type: VariableType
  value: string | boolean | number | object | any[]
}

export interface VariablesState {
  variables: Record<string, Variable>
  isLoading: boolean
  error: string | null
}

export interface VariablesStore extends VariablesState {
  // CRUD operations
  addVariable: (variable: Omit<Variable, 'id'>) => string
  updateVariable: (id: string, update: Partial<Omit<Variable, 'id' | 'workflowId'>>) => void
  deleteVariable: (id: string) => void
  duplicateVariable: (id: string) => string
  
  // DB interactions
  loadVariables: (workflowId: string) => Promise<void>
  saveVariables: (workflowId: string) => Promise<void>
  
  // Utility methods
  getVariablesByWorkflowId: (workflowId: string) => Variable[]
}
