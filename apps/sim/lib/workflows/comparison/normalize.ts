/**
 * Shared normalization utilities for workflow change detection.
 * Used by both client-side signature computation and server-side comparison.
 */

import type { Edge } from 'reactflow'
import { isNonEmptyValue } from '@/lib/workflows/subblocks/visibility'
import type {
  BlockState,
  Loop,
  Parallel,
  Variable,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import { SYSTEM_SUBBLOCK_IDS, TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

/**
 * Block data fields to exclude from comparison/hashing.
 * These are either:
 * - Visual/runtime-derived fields
 * - React Flow internal fields
 * - Duplicated in loops/parallels state (source of truth is there, not block.data)
 * - Duplicated in subBlocks (user config comes from subBlocks, block.data is just a copy)
 */
export const EXCLUDED_BLOCK_DATA_FIELDS: readonly string[] = [
  // Visual/layout fields
  'width', // Container dimensions from autolayout
  'height', // Container dimensions from autolayout

  // React Flow internal fields
  'id', // Duplicated from block.id
  'type', // React Flow node type (e.g., "subflowNode")
  'parentId', // Parent-child relationship for React Flow
  'extent', // React Flow extent setting

  // Loop fields - duplicated in loops state and/or subBlocks
  'nodes', // Subflow node membership (derived at runtime)
  'loopType', // Duplicated in loops state
  'count', // Iteration count (duplicated in loops state)
  'collection', // Items to iterate (duplicated in subBlocks)
  'whileCondition', // While condition (duplicated in subBlocks)
  'doWhileCondition', // Do-While condition (duplicated in subBlocks)
  'forEachItems', // ForEach items (duplicated in loops state)
  'iterations', // Loop iterations (duplicated in loops state)

  // Parallel fields - duplicated in parallels state and/or subBlocks
  'parallelType', // Duplicated in parallels state
  'distribution', // Parallel distribution (derived during execution)
] as const

/**
 * Normalizes a value for consistent comparison by:
 * - Sorting object keys recursively
 * - Filtering out null/undefined values from objects (treats them as equivalent to missing)
 * - Recursively normalizing array elements
 *
 * @param value - The value to normalize
 * @returns A normalized version of the value with sorted keys and no null/undefined fields
 */
export function normalizeValue(value: unknown): unknown {
  // Treat null and undefined as equivalent - both become undefined (omitted from objects)
  if (value === null || value === undefined) {
    return undefined
  }

  if (typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const normalized = normalizeValue((value as Record<string, unknown>)[key])
    // Only include non-null/undefined values
    if (normalized !== undefined) {
      sorted[key] = normalized
    }
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
 * Normalizes a loop configuration by extracting only the relevant fields for the loop type.
 * Sorts the nodes array for consistent comparison (order doesn't affect execution - edges determine flow).
 * Only includes optional fields if they have non-null/undefined values.
 *
 * @param loop - The loop configuration object
 * @returns Normalized loop with only relevant fields
 */
export function normalizeLoop(loop: Loop | null | undefined): NormalizedLoop | null | undefined {
  if (!loop) return undefined // Normalize null to undefined
  const { id, nodes, loopType, iterations, forEachItems, whileCondition, doWhileCondition } = loop

  // Sort nodes for consistent comparison (execution order is determined by edges, not array order)
  const sortedNodes = [...nodes].sort()
  const base: NormalizedLoop = { id, nodes: sortedNodes, loopType }

  // Only add optional fields if they have non-null/undefined values
  switch (loopType) {
    case 'for':
      if (iterations != null) base.iterations = iterations
      break
    case 'forEach':
      if (forEachItems != null) base.forEachItems = forEachItems
      break
    case 'while':
      if (whileCondition != null) base.whileCondition = whileCondition
      break
    case 'doWhile':
      if (doWhileCondition != null) base.doWhileCondition = doWhileCondition
      break
  }

  return base
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
 * Normalizes a parallel configuration by extracting only the relevant fields for the parallel type.
 * Sorts the nodes array for consistent comparison (parallel execution doesn't depend on array order).
 * Only includes optional fields if they have non-null/undefined values.
 *
 * @param parallel - The parallel configuration object
 * @returns Normalized parallel with only relevant fields
 */
export function normalizeParallel(
  parallel: Parallel | null | undefined
): NormalizedParallel | null | undefined {
  if (!parallel) return undefined // Normalize null to undefined
  const { id, nodes, parallelType, count, distribution } = parallel

  // Sort nodes for consistent comparison (parallel execution doesn't depend on array order)
  const sortedNodes = [...nodes].sort()
  const base: NormalizedParallel = {
    id,
    nodes: sortedNodes,
    parallelType,
  }

  // Only add optional fields if they have non-null/undefined values
  switch (parallelType) {
    case 'count':
      if (count != null) base.count = count
      break
    case 'collection':
      if (distribution != null) base.distribution = distribution
      break
  }

  return base
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
type InputFormatItem = Record<string, unknown> & { collapsed?: boolean }

/**
 * Sanitizes inputFormat array by removing UI-only fields like collapsed
 * @param inputFormat - Array of input format configurations
 * @returns Sanitized input format array
 */
export function sanitizeInputFormat(inputFormat: unknown[] | undefined): Record<string, unknown>[] {
  if (!Array.isArray(inputFormat)) return []
  return inputFormat.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const { collapsed, ...rest } = item as InputFormatItem
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
 * Normalizes an edge by extracting only the connection-relevant fields.
 * Treats null and undefined as equivalent (omits the field if null/undefined).
 * @param edge - The edge object
 * @returns Normalized edge with only connection fields
 */
export function normalizeEdge(edge: Edge): NormalizedEdge {
  const normalized: NormalizedEdge = {
    source: edge.source,
    target: edge.target,
  }
  // Only include handles if they have a non-null value
  // This treats null and undefined as equivalent (both omitted)
  if (edge.sourceHandle != null) {
    normalized.sourceHandle = edge.sourceHandle
  }
  if (edge.targetHandle != null) {
    normalized.targetHandle = edge.targetHandle
  }
  return normalized
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

/** Block with optional diff markers added by copilot */
export type BlockWithDiffMarkers = BlockState & {
  is_diff?: string
  field_diffs?: Record<string, unknown>
}

/** SubBlock with optional diff marker */
export type SubBlockWithDiffMarker = {
  id: string
  type: string
  value: unknown
  is_diff?: string
}

/** Normalized block structure for comparison */
interface NormalizedBlock {
  [key: string]: unknown
  data: Record<string, unknown>
  subBlocks: Record<string, NormalizedSubBlock>
}

/** Normalized subBlock structure */
interface NormalizedSubBlock {
  [key: string]: unknown
  value: unknown
}

/** Normalized workflow state structure */
export interface NormalizedWorkflowState {
  blocks: Record<string, NormalizedBlock>
  edges: Array<{
    source: string
    sourceHandle?: string | null
    target: string
    targetHandle?: string | null
  }>
  loops: Record<string, unknown>
  parallels: Record<string, unknown>
  variables: unknown
}

/** Result of extracting block fields for comparison */
export interface ExtractedBlockFields {
  /** Block fields excluding visual-only fields (position, layout, height, outputs, diff markers) */
  blockRest: Record<string, unknown>
  /** Normalized data object excluding width/height/nodes/distribution */
  normalizedData: Record<string, unknown>
  /** SubBlocks map */
  subBlocks: Record<string, unknown>
}

/**
 * Normalizes block data by excluding visual/runtime/duplicated fields.
 * See EXCLUDED_BLOCK_DATA_FIELDS for the list of excluded fields.
 *
 * Also normalizes empty strings to undefined (removes them) because:
 * - Legacy deployed states may have empty string fields that current states don't have
 * - Empty string and undefined/missing are semantically equivalent for config fields
 *
 * @param data - The block data object
 * @returns Normalized data object
 */
export function normalizeBlockData(
  data: Record<string, unknown> | undefined
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data || {})) {
    // Skip excluded fields
    if (EXCLUDED_BLOCK_DATA_FIELDS.includes(key)) continue
    // Skip empty/null/undefined values (treat as equivalent to missing)
    if (!isNonEmptyValue(value)) continue

    normalized[key] = value
  }

  return normalized
}

/**
 * Extracts block fields for comparison, excluding visual-only and runtime fields.
 * Excludes: position, layout, height, outputs, is_diff, field_diffs
 *
 * @param block - The block state
 * @returns Extracted fields suitable for comparison
 */
export function extractBlockFieldsForComparison(block: BlockState): ExtractedBlockFields {
  const blockWithDiff = block as BlockWithDiffMarkers
  const {
    position: _position,
    subBlocks = {},
    layout: _layout,
    height: _height,
    outputs: _outputs,
    is_diff: _isDiff,
    field_diffs: _fieldDiffs,
    ...blockRest
  } = blockWithDiff

  return {
    blockRest,
    normalizedData: normalizeBlockData(blockRest.data as Record<string, unknown> | undefined),
    subBlocks,
  }
}

/**
 * Filters subBlock IDs to exclude system and trigger runtime subBlocks.
 *
 * @param subBlockIds - Array of subBlock IDs to filter
 * @returns Filtered and sorted array of subBlock IDs
 */
export function filterSubBlockIds(subBlockIds: string[]): string[] {
  return subBlockIds
    .filter((id) => !SYSTEM_SUBBLOCK_IDS.includes(id) && !TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(id))
    .sort()
}

/**
 * Normalizes a subBlock value with sanitization for specific subBlock types.
 * Sanitizes: tools (removes isExpanded), inputFormat (removes collapsed)
 *
 * @param subBlockId - The subBlock ID
 * @param value - The subBlock value
 * @returns Normalized value
 */
export function normalizeSubBlockValue(subBlockId: string, value: unknown): unknown {
  let normalizedValue = value ?? null

  if (subBlockId === 'tools' && Array.isArray(normalizedValue)) {
    normalizedValue = sanitizeTools(normalizedValue)
  }
  if (subBlockId === 'inputFormat' && Array.isArray(normalizedValue)) {
    normalizedValue = sanitizeInputFormat(normalizedValue)
  }

  return normalizedValue
}

/**
 * Extracts subBlock fields for comparison, excluding diff markers.
 *
 * @param subBlock - The subBlock object
 * @returns SubBlock fields excluding value and is_diff
 */
export function extractSubBlockRest(subBlock: Record<string, unknown>): Record<string, unknown> {
  const { value: _v, is_diff: _sd, ...rest } = subBlock as SubBlockWithDiffMarker
  return rest
}

/**
 * Normalizes a workflow state for comparison or hashing.
 * Excludes non-functional fields (position, layout, height, outputs, diff markers)
 * and system/trigger runtime subBlocks.
 *
 * @param state - The workflow state to normalize
 * @returns A normalized workflow state suitable for comparison or hashing
 */
export function normalizeWorkflowState(state: WorkflowState): NormalizedWorkflowState {
  // 1. Normalize and sort edges (connection-relevant fields only)
  const normalizedEdges = sortEdges((state.edges || []).map(normalizeEdge))

  // 2. Normalize blocks
  const normalizedBlocks: Record<string, NormalizedBlock> = {}

  for (const [blockId, block] of Object.entries(state.blocks || {})) {
    const {
      blockRest,
      normalizedData,
      subBlocks: blockSubBlocks,
    } = extractBlockFieldsForComparison(block)

    // Filter and normalize subBlocks (exclude system/trigger runtime subBlocks)
    const normalizedSubBlocks: Record<string, NormalizedSubBlock> = {}
    const subBlockIds = filterSubBlockIds(Object.keys(blockSubBlocks))

    for (const subBlockId of subBlockIds) {
      const subBlock = blockSubBlocks[subBlockId] as SubBlockWithDiffMarker
      const value = normalizeSubBlockValue(subBlockId, subBlock.value)
      const subBlockRest = extractSubBlockRest(subBlock as Record<string, unknown>)

      normalizedSubBlocks[subBlockId] = {
        ...subBlockRest,
        value: normalizeValue(value),
      }
    }

    normalizedBlocks[blockId] = {
      ...blockRest,
      data: normalizedData,
      subBlocks: normalizedSubBlocks,
    }
  }

  // 3. Normalize loops using specialized normalizeLoop (extracts only type-relevant fields)
  const normalizedLoops: Record<string, unknown> = {}
  for (const [loopId, loop] of Object.entries(state.loops || {})) {
    normalizedLoops[loopId] = normalizeValue(normalizeLoop(loop))
  }

  // 4. Normalize parallels using specialized normalizeParallel
  const normalizedParallels: Record<string, unknown> = {}
  for (const [parallelId, parallel] of Object.entries(state.parallels || {})) {
    normalizedParallels[parallelId] = normalizeValue(normalizeParallel(parallel))
  }

  // 5. Normalize variables (remove UI-only validationError field)
  const variables = normalizeVariables(state.variables)
  const normalizedVariablesObj = normalizeValue(
    Object.fromEntries(Object.entries(variables).map(([id, v]) => [id, sanitizeVariable(v)]))
  )

  return {
    blocks: normalizedBlocks,
    edges: normalizedEdges,
    loops: normalizedLoops,
    parallels: normalizedParallels,
    variables: normalizedVariablesObj,
  }
}
