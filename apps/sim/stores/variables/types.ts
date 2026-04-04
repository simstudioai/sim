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
 * Variable data lives in the panel variables store (`@/stores/panel/variables`).
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
