export type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export interface Variable {
  id: string
  name: string
  type: VariableType
  value: string | number | boolean | object | any[]
  description?: string
  workflowId: string
  createdAt: string
  updatedAt: string
}

export interface VariablesState {
  variables: Record<string, Variable>
  isCreating: boolean
  isEditing: string | null
}

export interface VariablesStore extends VariablesState {
  addVariable: (variable: Omit<Variable, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateVariable: (id: string, updates: Partial<Omit<Variable, 'id' | 'workflowId'>>) => void
  deleteVariable: (id: string) => void
  duplicateVariable: (id: string) => string
  setIsCreating: (isCreating: boolean) => void
  setIsEditing: (id: string | null) => void
  getVariablesByWorkflowId: (workflowId: string) => Variable[]
}
