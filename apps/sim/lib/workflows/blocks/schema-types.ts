import type { LucideIcon } from 'lucide-react'

/** A fully resolved block schema with all sub-blocks expanded */
export interface ResolvedBlock {
  type: string
  name: string
  description?: string
  category: string
  icon?: LucideIcon
  isTrigger: boolean
  hideFromToolbar: boolean

  /** Resolved sub-blocks with options, conditions, and validation info */
  subBlocks: ResolvedSubBlock[]

  /** Block-level outputs */
  outputs: ResolvedOutput[]

  /** Whether this block supports trigger mode */
  supportsTriggerMode: boolean

  /** Whether this block has advanced mode */
  hasAdvancedMode: boolean

  /** Raw config reference for consumers that need it */
  raw: unknown
}

/** A resolved sub-block with options and metadata */
export interface ResolvedSubBlock {
  id: string
  type: string
  label?: string
  placeholder?: string
  required?: boolean
  password?: boolean

  /** Resolved options (for dropdowns/selectors, etc.) */
  options?: ResolvedOption[]

  /** Whether this sub-block has a condition that controls visibility */
  hasCondition: boolean

  /** Condition details if present */
  condition?: {
    field: string
    value: unknown
    /** Whether condition is currently met (if evaluable statically) */
    met?: boolean
  }

  /** Validation constraints */
  validation?: {
    min?: number
    max?: number
    pattern?: string
  }

  /** Default value */
  defaultValue?: unknown
}

/** A resolved option for dropdowns/selectors */
export interface ResolvedOption {
  label: string
  value: string
  id?: string
}

/** A resolved output definition */
export interface ResolvedOutput {
  name: string
  type: string
  description?: string
}
