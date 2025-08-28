/**
 * Variable types supported in the application
 * Note: 'string' is deprecated - use 'plain' for text values instead
 */
export type VariableType = 'plain' | 'number' | 'boolean' | 'object' | 'array' | 'string'

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
  validationError?: string // Tracks format validation errors
}

export interface VariablesStore {
  variables: Record<string, Variable>
  isLoading: boolean
  error: string | null
  isEditing: string | null

  /**
   * Adds a new variable with automatic name uniqueness validation
   * If a variable with the same name exists, it will be suffixed with a number
   * Optionally accepts a predetermined ID for collaborative operations
   */
  addVariable: (variable: Omit<Variable, 'id'>, providedId?: string) => string

  /**
   * Updates a variable, ensuring name remains unique within the workflow
   * If an updated name conflicts with existing ones, a numbered suffix is added
   */
  updateVariable: (id: string, update: Partial<Omit<Variable, 'id' | 'workflowId'>>) => void

  deleteVariable: (id: string) => void

  /**
   * Duplicates a variable with a "(copy)" suffix, ensuring name uniqueness
   * Optionally accepts a predetermined ID for collaborative operations
   */
  duplicateVariable: (id: string, providedId?: string) => string

  /**
   * Returns all variables for a specific workflow
   */
  getVariablesByWorkflowId: (workflowId: string) => Variable[]
}
