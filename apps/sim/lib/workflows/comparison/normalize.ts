/**
 * Shared normalization utilities for workflow change detection.
 * Used by both client-side signature computation and server-side comparison.
 */

import type { Edge } from 'reactflow'
import type {
  BlockState,
  Loop,
  Parallel,
  Variable,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import { SYSTEM_SUBBLOCK_IDS, TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

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

/** Block with optional diff markers added by copilot */
type BlockWithDiffMarkers = BlockState & {
  is_diff?: string
  field_diffs?: Record<string, unknown>
}

/** SubBlock with optional diff marker */
type SubBlockWithDiffMarker = {
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
    const blockWithDiff = block as BlockWithDiffMarkers

    // Exclude non-functional fields:
    // - position: visual positioning only
    // - layout: contains measuredWidth/measuredHeight from autolayout
    // - height: block height measurement from autolayout
    // - outputs: derived from subBlocks, already compared via subBlocks
    // - is_diff, field_diffs: diff markers from copilot edits
    // - subBlocks: handled separately
    const {
      position: _position,
      subBlocks: blockSubBlocks = {},
      layout: _layout,
      height: _height,
      outputs: _outputs,
      is_diff: _isDiff,
      field_diffs: _fieldDiffs,
      ...blockRest
    } = blockWithDiff

    // Exclude from data object:
    // - width/height: container dimensions from autolayout
    // - nodes: subflow node membership (derived/runtime for parallel/loop blocks)
    // - distribution: parallel distribution (derived/runtime)
    const {
      width: _dataWidth,
      height: _dataHeight,
      nodes: _dataNodes,
      distribution: _dataDistribution,
      ...dataRest
    } = (blockRest.data || {}) as Record<string, unknown>

    // Filter and normalize subBlocks (exclude system/trigger runtime subBlocks)
    const normalizedSubBlocks: Record<string, NormalizedSubBlock> = {}
    const subBlockIds = Object.keys(blockSubBlocks)
      .filter(
        (id) => !SYSTEM_SUBBLOCK_IDS.includes(id) && !TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(id)
      )
      .sort()

    for (const subBlockId of subBlockIds) {
      const subBlock = blockSubBlocks[subBlockId] as SubBlockWithDiffMarker
      let value: unknown = subBlock.value ?? null

      // Sanitize UI-only fields from tools and inputFormat
      if (subBlockId === 'tools' && Array.isArray(value)) {
        value = sanitizeTools(value)
      }
      if (subBlockId === 'inputFormat' && Array.isArray(value)) {
        value = sanitizeInputFormat(value)
      }

      // Exclude diff markers from subBlock
      const { value: _v, is_diff: _sd, ...subBlockRest } = subBlock

      normalizedSubBlocks[subBlockId] = {
        ...subBlockRest,
        value: normalizeValue(value),
      }
    }

    normalizedBlocks[blockId] = {
      ...blockRest,
      data: dataRest,
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
