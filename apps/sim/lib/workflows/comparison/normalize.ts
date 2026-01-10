/**
 * Shared normalization utilities for workflow change detection.
 * Used by both client-side signature computation and server-side comparison.
 */

import type { Edge } from 'reactflow'
import type { Loop, Parallel, Variable } from '@/stores/workflows/workflow/types'

/**
 * Normalizes a value for consistent comparison by sorting object keys recursively
 * @param value - The value to normalize
 * @returns A normalized version of the value with sorted keys
 */
export function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = normalizeValue((value as Record<string, unknown>)[key])
  }
  return sorted
}

/**
 * Generates a normalized JSON string for comparison
 * @param value - The value to normalize and stringify
 * @returns A normalized JSON string
 */
export function normalizedStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value))
}

/** Normalized loop result type with only essential fields */
interface NormalizedLoop {
  id: string
  nodes: string[]
  loopType: Loop['loopType']
  iterations?: number
  forEachItems?: Loop['forEachItems']
  whileCondition?: string
  doWhileCondition?: string
}

/**
 * Normalizes a loop configuration by extracting only the relevant fields for the loop type
 * @param loop - The loop configuration object
 * @returns Normalized loop with only relevant fields
 */
export function normalizeLoop(loop: Loop | null | undefined): NormalizedLoop | null | undefined {
  if (!loop) return loop
  const { id, nodes, loopType, iterations, forEachItems, whileCondition, doWhileCondition } = loop
  const base: Pick<NormalizedLoop, 'id' | 'nodes' | 'loopType'> = { id, nodes, loopType }

  switch (loopType) {
    case 'for':
      return { ...base, iterations }
    case 'forEach':
      return { ...base, forEachItems }
    case 'while':
      return { ...base, whileCondition }
    case 'doWhile':
      return { ...base, doWhileCondition }
    default:
      return base
  }
}

/** Normalized parallel result type with only essential fields */
interface NormalizedParallel {
  id: string
  nodes: string[]
  parallelType: Parallel['parallelType']
  count?: number
  distribution?: Parallel['distribution']
}

/**
 * Normalizes a parallel configuration by extracting only the relevant fields for the parallel type
 * @param parallel - The parallel configuration object
 * @returns Normalized parallel with only relevant fields
 */
export function normalizeParallel(
  parallel: Parallel | null | undefined
): NormalizedParallel | null | undefined {
  if (!parallel) return parallel
  const { id, nodes, parallelType, count, distribution } = parallel
  const base: Pick<NormalizedParallel, 'id' | 'nodes' | 'parallelType'> = {
    id,
    nodes,
    parallelType,
  }

  switch (parallelType) {
    case 'count':
      return { ...base, count }
    case 'collection':
      return { ...base, distribution }
    default:
      return base
  }
}

/** Tool configuration with optional UI-only isExpanded field */
type ToolWithExpanded = Record<string, unknown> & { isExpanded?: boolean }

/**
 * Sanitizes tools array by removing UI-only fields like isExpanded
 * @param tools - Array of tool configurations
 * @returns Sanitized tools array
 */
export function sanitizeTools(tools: unknown[] | undefined): Record<string, unknown>[] {
  if (!Array.isArray(tools)) return []

  return tools.map((tool) => {
    if (tool && typeof tool === 'object' && !Array.isArray(tool)) {
      const { isExpanded, ...rest } = tool as ToolWithExpanded
      return rest
    }
    return tool as Record<string, unknown>
  })
}

/** Variable with optional UI-only validationError field */
type VariableWithValidation = Variable & { validationError?: string }

/**
 * Sanitizes a variable by removing UI-only fields like validationError
 * @param variable - The variable object
 * @returns Sanitized variable object
 */
export function sanitizeVariable(
  variable: VariableWithValidation | null | undefined
): Omit<VariableWithValidation, 'validationError'> | null | undefined {
  if (!variable || typeof variable !== 'object') return variable
  const { validationError, ...rest } = variable
  return rest
}

/**
 * Normalizes the variables structure to always be an object.
 * Handles legacy data where variables might be stored as an empty array.
 * @param variables - The variables to normalize
 * @returns A normalized variables object
 */
export function normalizeVariables(variables: unknown): Record<string, Variable> {
  if (!variables) return {}
  if (Array.isArray(variables)) return {}
  if (typeof variables !== 'object') return {}
  return variables as Record<string, Variable>
}

/** Input format item with optional UI-only fields */
type InputFormatItem = Record<string, unknown> & { value?: unknown; collapsed?: boolean }

/**
 * Sanitizes inputFormat array by removing UI-only fields like value and collapsed
 * @param inputFormat - Array of input format configurations
 * @returns Sanitized input format array
 */
export function sanitizeInputFormat(inputFormat: unknown[] | undefined): Record<string, unknown>[] {
  if (!Array.isArray(inputFormat)) return []
  return inputFormat.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const { value, collapsed, ...rest } = item as InputFormatItem
      return rest
    }
    return item as Record<string, unknown>
  })
}

/** Normalized edge with only connection-relevant fields */
interface NormalizedEdge {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/**
 * Normalizes an edge by extracting only the connection-relevant fields
 * @param edge - The edge object
 * @returns Normalized edge with only connection fields
 */
export function normalizeEdge(edge: Edge): NormalizedEdge {
  return {
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  }
}

/**
 * Sorts edges for consistent comparison
 * @param edges - Array of edges to sort
 * @returns Sorted array of normalized edges
 */
export function sortEdges(
  edges: Array<{
    source: string
    sourceHandle?: string | null
    target: string
    targetHandle?: string | null
  }>
): Array<{
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}> {
  return [...edges].sort((a, b) =>
    `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
      `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
    )
  )
}
