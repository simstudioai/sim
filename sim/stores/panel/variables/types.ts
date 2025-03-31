export type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array'

/**
 * Represents a workflow variable with workflow-specific naming
 * Variable names must be unique within each workflow
 */
export interface Variable {
  id: string
  workflowId: string
  name: string // Must be unique per workflow
  type: VariableType
  value: any
}

export interface VariablesStore {
  variables: Record<string, Variable>
  isLoading: boolean
  error: string | null
  isEditing: string | null

  /**
   * Adds a new variable with automatic name uniqueness validation
   * If a variable with the same name exists, it will be suffixed with a number
   */
  addVariable: (variable: Omit<Variable, 'id'>) => string

  /**
   * Updates a variable, ensuring name remains unique within the workflow
   * If an updated name conflicts with existing ones, a numbered suffix is added
   */
  updateVariable: (id: string, update: Partial<Omit<Variable, 'id' | 'workflowId'>>) => void

  deleteVariable: (id: string) => void

  /**
   * Duplicates a variable with a "(copy)" suffix, ensuring name uniqueness
   */
  duplicateVariable: (id: string) => string

  loadVariables: (workflowId: string) => Promise<void>
  saveVariables: (workflowId: string) => Promise<void>

  /**
   * Returns all variables for a specific workflow
   */
  getVariablesByWorkflowId: (workflowId: string) => Variable[]

  /**
   * Resets tracking of loaded workflows
   */
  resetLoaded: () => void
}
