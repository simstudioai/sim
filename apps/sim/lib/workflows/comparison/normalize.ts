/**
 * Shared normalization utilities for workflow change detection.
 * Used by both client-side signature computation and server-side comparison.
 */

/**
 * Normalizes a value for consistent comparison by sorting object keys recursively
 * @param value - The value to normalize
 * @returns A normalized version of the value with sorted keys
 */
export function normalizeValue(value: any): any {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  const sorted: Record<string, any> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = normalizeValue(value[key])
  }
  return sorted
}

/**
 * Generates a normalized JSON string for comparison
 * @param value - The value to normalize and stringify
 * @returns A normalized JSON string
 */
export function normalizedStringify(value: any): string {
  return JSON.stringify(normalizeValue(value))
}

/**
 * Normalizes a loop configuration by extracting only the relevant fields for the loop type
 * @param loop - The loop configuration object
 * @returns Normalized loop with only relevant fields
 */
export function normalizeLoop(loop: any): any {
  if (!loop) return loop
  const { id, nodes, loopType, iterations, forEachItems, whileCondition, doWhileCondition } = loop
  const base: any = { id, nodes, loopType }

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

/**
 * Normalizes a parallel configuration by extracting only the relevant fields for the parallel type
 * @param parallel - The parallel configuration object
 * @returns Normalized parallel with only relevant fields
 */
export function normalizeParallel(parallel: any): any {
  if (!parallel) return parallel
  const { id, nodes, parallelType, count, distribution } = parallel
  const base: any = { id, nodes, parallelType }

  switch (parallelType) {
    case 'count':
      return { ...base, count }
    case 'collection':
      return { ...base, distribution }
    default:
      return base
  }
}

/**
 * Sanitizes tools array by removing UI-only fields like isExpanded
 * @param tools - Array of tool configurations
 * @returns Sanitized tools array
 */
export function sanitizeTools(tools: any[] | undefined): any[] {
  if (!Array.isArray(tools)) return []

  return tools.map(({ isExpanded, ...rest }) => rest)
}

/**
 * Sanitizes a variable by removing UI-only fields like validationError
 * @param variable - The variable object
 * @returns Sanitized variable object
 */
export function sanitizeVariable(variable: any): any {
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
export function normalizeVariables(variables: any): Record<string, any> {
  if (!variables) return {}
  if (Array.isArray(variables)) return {}
  if (typeof variables !== 'object') return {}
  return variables
}

/**
 * Sanitizes inputFormat array by removing UI-only fields like value and collapsed
 * @param inputFormat - Array of input format configurations
 * @returns Sanitized input format array
 */
export function sanitizeInputFormat(inputFormat: any[] | undefined): any[] {
  if (!Array.isArray(inputFormat)) return []
  return inputFormat.map(({ value, collapsed, ...rest }) => rest)
}

/**
 * Normalizes an edge by extracting only the connection-relevant fields
 * @param edge - The edge object
 * @returns Normalized edge with only connection fields
 */
export function normalizeEdge(edge: any): {
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
} {
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
  edges: Array<{ source: string; sourceHandle?: string; target: string; targetHandle?: string }>
): Array<{ source: string; sourceHandle?: string; target: string; targetHandle?: string }> {
  return [...edges].sort((a, b) =>
    `${a.source}-${a.sourceHandle}-${a.target}-${a.targetHandle}`.localeCompare(
      `${b.source}-${b.sourceHandle}-${b.target}-${b.targetHandle}`
    )
  )
}
