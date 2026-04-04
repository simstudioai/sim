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
  value: unknown
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
   * Returns all variables for a specific workflow
   */
  getVariablesByWorkflowId: (workflowId: string) => Variable[]
}

/**
 * 2D position used by the floating variables modal.
 */
export interface VariablesPosition {
  x: number
  y: number
}

/**
 * Dimensions for the floating variables modal.
 */
export interface VariablesDimensions {
  width: number
  height: number
}

/**
 * UI-only store interface for the floating variables modal.
 * Variable data lives in the variables data store (`@/stores/variables/store`).
 */
export interface VariablesModalStore {
  isOpen: boolean
  position: VariablesPosition | null
  width: number
  height: number
  setIsOpen: (open: boolean) => void
  setPosition: (position: VariablesPosition) => void
  setDimensions: (dimensions: VariablesDimensions) => void
  resetPosition: () => void
}
