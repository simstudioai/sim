/**
 * Variable types supported by the variables modal/editor.
 * Note: 'string' is deprecated. Use 'plain' for freeform text values instead.
 */
export type VariableType = 'plain' | 'number' | 'boolean' | 'object' | 'array' | 'string'

/**
 * Workflow-scoped variable model.
 */
export interface Variable {
  id: string
  workflowId: string
  name: string
  type: VariableType
  value: unknown
  validationError?: string
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
 * Public store interface for variables editor/modal.
 * Combines UI state of the floating modal and the variables data/actions.
 */
export interface VariablesStore {
  // UI State
  isOpen: boolean
  position: VariablesPosition | null
  width: number
  height: number
  setIsOpen: (open: boolean) => void
  setPosition: (position: VariablesPosition) => void
  setDimensions: (dimensions: VariablesDimensions) => void
  resetPosition: () => void

  // Data
  variables: Record<string, Variable>
  isLoading: boolean
  error: string | null

  // Actions
  loadForWorkflow: (workflowId: string) => Promise<void>
  addVariable: (variable: Omit<Variable, 'id'>, providedId?: string) => string
  updateVariable: (id: string, update: Partial<Omit<Variable, 'id' | 'workflowId'>>) => void
  deleteVariable: (id: string) => void
  duplicateVariable: (id: string, providedId?: string) => string
  getVariablesByWorkflowId: (workflowId: string) => Variable[]
}
