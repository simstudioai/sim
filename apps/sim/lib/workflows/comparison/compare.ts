import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { SYSTEM_SUBBLOCK_IDS, TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'
import {
  normalizedStringify,
  normalizeEdge,
  normalizeLoop,
  normalizeParallel,
  normalizeValue,
  normalizeVariables,
  sanitizeInputFormat,
  sanitizeTools,
  sanitizeVariable,
  sortEdges,
} from './normalize'

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

/**
 * Compare the current workflow state with the deployed state to detect meaningful changes
 * @param currentState - The current workflow state
 * @param deployedState - The deployed workflow state
 * @returns True if there are meaningful changes, false if only position changes or no changes
 */
export function hasWorkflowChanged(
  currentState: WorkflowState,
  deployedState: WorkflowState | null
): boolean {
  // If no deployed state exists, then the workflow has changed
  if (!deployedState) return true

  // 1. Compare edges (connections between blocks)
  const currentEdges = currentState.edges || []
  const deployedEdges = deployedState.edges || []

  const normalizedCurrentEdges = sortEdges(currentEdges.map(normalizeEdge))
  const normalizedDeployedEdges = sortEdges(deployedEdges.map(normalizeEdge))

  if (
    normalizedStringify(normalizedCurrentEdges) !== normalizedStringify(normalizedDeployedEdges)
  ) {
    return true
  }

  // 2. Compare blocks and their configurations
  const currentBlockIds = Object.keys(currentState.blocks || {}).sort()
  const deployedBlockIds = Object.keys(deployedState.blocks || {}).sort()

  if (
    currentBlockIds.length !== deployedBlockIds.length ||
    normalizedStringify(currentBlockIds) !== normalizedStringify(deployedBlockIds)
  ) {
    return true
  }

  // 3. Build normalized representations of blocks for comparison
  const normalizedCurrentBlocks: Record<string, unknown> = {}
  const normalizedDeployedBlocks: Record<string, unknown> = {}

  for (const blockId of currentBlockIds) {
    const currentBlock = currentState.blocks[blockId]
    const deployedBlock = deployedState.blocks[blockId]

    // Destructure and exclude non-functional fields:
    // - position: visual positioning only
    // - subBlocks: handled separately below
    // - layout: contains measuredWidth/measuredHeight from autolayout
    // - height: block height measurement from autolayout
    // - outputs: derived from subBlocks (e.g., inputFormat), already compared via subBlocks
    // - is_diff, field_diffs: diff markers from copilot edits
    const currentBlockWithDiff = currentBlock as BlockWithDiffMarkers
    const deployedBlockWithDiff = deployedBlock as BlockWithDiffMarkers

    const {
      position: _currentPos,
      subBlocks: currentSubBlocks = {},
      layout: _currentLayout,
      height: _currentHeight,
      outputs: _currentOutputs,
      is_diff: _currentIsDiff,
      field_diffs: _currentFieldDiffs,
      ...currentRest
    } = currentBlockWithDiff

    const {
      position: _deployedPos,
      subBlocks: deployedSubBlocks = {},
      layout: _deployedLayout,
      height: _deployedHeight,
      outputs: _deployedOutputs,
      is_diff: _deployedIsDiff,
      field_diffs: _deployedFieldDiffs,
      ...deployedRest
    } = deployedBlockWithDiff

    // Also exclude width/height from data object (container dimensions from autolayout)
    const {
      width: _currentDataWidth,
      height: _currentDataHeight,
      ...currentDataRest
    } = currentRest.data || {}
    const {
      width: _deployedDataWidth,
      height: _deployedDataHeight,
      ...deployedDataRest
    } = deployedRest.data || {}

    normalizedCurrentBlocks[blockId] = {
      ...currentRest,
      data: currentDataRest,
      subBlocks: undefined,
    }

    normalizedDeployedBlocks[blockId] = {
      ...deployedRest,
      data: deployedDataRest,
      subBlocks: undefined,
    }

    // Get all subBlock IDs from both states, excluding runtime metadata and UI-only elements
    const allSubBlockIds = [
      ...new Set([...Object.keys(currentSubBlocks), ...Object.keys(deployedSubBlocks)]),
    ]
      .filter(
        (id) => !TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(id) && !SYSTEM_SUBBLOCK_IDS.includes(id)
      )
      .sort()

    // Normalize and compare each subBlock
    for (const subBlockId of allSubBlockIds) {
      // If the subBlock doesn't exist in either state, there's a difference
      if (!currentSubBlocks[subBlockId] || !deployedSubBlocks[subBlockId]) {
        return true
      }

      // Get values with special handling for null/undefined
      // Using unknown type since sanitization functions return different types
      let currentValue: unknown = currentSubBlocks[subBlockId].value ?? null
      let deployedValue: unknown = deployedSubBlocks[subBlockId].value ?? null

      if (subBlockId === 'tools' && Array.isArray(currentValue) && Array.isArray(deployedValue)) {
        currentValue = sanitizeTools(currentValue)
        deployedValue = sanitizeTools(deployedValue)
      }

      if (
        subBlockId === 'inputFormat' &&
        Array.isArray(currentValue) &&
        Array.isArray(deployedValue)
      ) {
        currentValue = sanitizeInputFormat(currentValue)
        deployedValue = sanitizeInputFormat(deployedValue)
      }

      // For string values, compare directly to catch even small text changes
      if (typeof currentValue === 'string' && typeof deployedValue === 'string') {
        if (currentValue !== deployedValue) {
          return true
        }
      } else {
        // For other types, use normalized comparison
        const normalizedCurrentValue = normalizeValue(currentValue)
        const normalizedDeployedValue = normalizeValue(deployedValue)

        if (
          normalizedStringify(normalizedCurrentValue) !==
          normalizedStringify(normalizedDeployedValue)
        ) {
          return true
        }
      }

      // Compare type and other properties (excluding diff markers and value)
      const currentSubBlockWithDiff = currentSubBlocks[subBlockId] as SubBlockWithDiffMarker
      const deployedSubBlockWithDiff = deployedSubBlocks[subBlockId] as SubBlockWithDiffMarker
      const { value: _cv, is_diff: _cd, ...currentSubBlockRest } = currentSubBlockWithDiff
      const { value: _dv, is_diff: _dd, ...deployedSubBlockRest } = deployedSubBlockWithDiff

      if (normalizedStringify(currentSubBlockRest) !== normalizedStringify(deployedSubBlockRest)) {
        return true
      }
    }

    const blocksEqual =
      normalizedStringify(normalizedCurrentBlocks[blockId]) ===
      normalizedStringify(normalizedDeployedBlocks[blockId])

    if (!blocksEqual) {
      return true
    }
  }

  // 4. Compare loops
  const currentLoops = currentState.loops || {}
  const deployedLoops = deployedState.loops || {}

  const currentLoopIds = Object.keys(currentLoops).sort()
  const deployedLoopIds = Object.keys(deployedLoops).sort()

  if (
    currentLoopIds.length !== deployedLoopIds.length ||
    normalizedStringify(currentLoopIds) !== normalizedStringify(deployedLoopIds)
  ) {
    return true
  }

  for (const loopId of currentLoopIds) {
    const normalizedCurrentLoop = normalizeValue(normalizeLoop(currentLoops[loopId]))
    const normalizedDeployedLoop = normalizeValue(normalizeLoop(deployedLoops[loopId]))

    if (
      normalizedStringify(normalizedCurrentLoop) !== normalizedStringify(normalizedDeployedLoop)
    ) {
      return true
    }
  }

  // 5. Compare parallels
  const currentParallels = currentState.parallels || {}
  const deployedParallels = deployedState.parallels || {}

  const currentParallelIds = Object.keys(currentParallels).sort()
  const deployedParallelIds = Object.keys(deployedParallels).sort()

  if (
    currentParallelIds.length !== deployedParallelIds.length ||
    normalizedStringify(currentParallelIds) !== normalizedStringify(deployedParallelIds)
  ) {
    return true
  }

  for (const parallelId of currentParallelIds) {
    const normalizedCurrentParallel = normalizeValue(
      normalizeParallel(currentParallels[parallelId])
    )
    const normalizedDeployedParallel = normalizeValue(
      normalizeParallel(deployedParallels[parallelId])
    )

    if (
      normalizedStringify(normalizedCurrentParallel) !==
      normalizedStringify(normalizedDeployedParallel)
    ) {
      return true
    }
  }

  // 6. Compare variables
  const currentVariables = normalizeVariables(currentState.variables)
  const deployedVariables = normalizeVariables(deployedState.variables)

  const normalizedCurrentVars = normalizeValue(
    Object.fromEntries(Object.entries(currentVariables).map(([id, v]) => [id, sanitizeVariable(v)]))
  )
  const normalizedDeployedVars = normalizeValue(
    Object.fromEntries(
      Object.entries(deployedVariables).map(([id, v]) => [id, sanitizeVariable(v)])
    )
  )

  if (normalizedStringify(normalizedCurrentVars) !== normalizedStringify(normalizedDeployedVars)) {
    return true
  }

  return false
}

/**
 * Represents a single field change with old and new values
 */
export interface FieldChange {
  field: string
  oldValue: unknown
  newValue: unknown
}

/**
 * Result of workflow diff analysis between two workflow states
 */
export interface WorkflowDiffSummary {
  addedBlocks: Array<{ id: string; type: string; name?: string }>
  removedBlocks: Array<{ id: string; type: string; name?: string }>
  modifiedBlocks: Array<{ id: string; type: string; name?: string; changes: FieldChange[] }>
  edgeChanges: { added: number; removed: number }
  loopChanges: { added: number; removed: number }
  parallelChanges: { added: number; removed: number }
  variableChanges: { added: number; removed: number; modified: number }
  hasChanges: boolean
}

/**
 * Generate a detailed diff summary between two workflow states
 */
export function generateWorkflowDiffSummary(
  currentState: WorkflowState,
  previousState: WorkflowState | null
): WorkflowDiffSummary {
  const result: WorkflowDiffSummary = {
    addedBlocks: [],
    removedBlocks: [],
    modifiedBlocks: [],
    edgeChanges: { added: 0, removed: 0 },
    loopChanges: { added: 0, removed: 0 },
    parallelChanges: { added: 0, removed: 0 },
    variableChanges: { added: 0, removed: 0, modified: 0 },
    hasChanges: false,
  }

  if (!previousState) {
    const currentBlocks = currentState.blocks || {}
    for (const [id, block] of Object.entries(currentBlocks)) {
      result.addedBlocks.push({
        id,
        type: block.type,
        name: block.name,
      })
    }
    result.edgeChanges.added = (currentState.edges || []).length
    result.loopChanges.added = Object.keys(currentState.loops || {}).length
    result.parallelChanges.added = Object.keys(currentState.parallels || {}).length
    result.variableChanges.added = Object.keys(currentState.variables || {}).length
    result.hasChanges = true
    return result
  }

  const currentBlocks = currentState.blocks || {}
  const previousBlocks = previousState.blocks || {}
  const currentBlockIds = new Set(Object.keys(currentBlocks))
  const previousBlockIds = new Set(Object.keys(previousBlocks))

  for (const id of currentBlockIds) {
    if (!previousBlockIds.has(id)) {
      const block = currentBlocks[id]
      result.addedBlocks.push({
        id,
        type: block.type,
        name: block.name,
      })
    }
  }

  for (const id of previousBlockIds) {
    if (!currentBlockIds.has(id)) {
      const block = previousBlocks[id]
      result.removedBlocks.push({
        id,
        type: block.type,
        name: block.name,
      })
    }
  }

  for (const id of currentBlockIds) {
    if (!previousBlockIds.has(id)) continue

    const currentBlock = currentBlocks[id] as BlockWithDiffMarkers
    const previousBlock = previousBlocks[id] as BlockWithDiffMarkers
    const changes: FieldChange[] = []

    if (currentBlock.name !== previousBlock.name) {
      changes.push({ field: 'name', oldValue: previousBlock.name, newValue: currentBlock.name })
    }
    if (currentBlock.enabled !== previousBlock.enabled) {
      changes.push({
        field: 'enabled',
        oldValue: previousBlock.enabled,
        newValue: currentBlock.enabled,
      })
    }

    const currentSubBlocks = currentBlock.subBlocks || {}
    const previousSubBlocks = previousBlock.subBlocks || {}
    const allSubBlockIds = new Set([
      ...Object.keys(currentSubBlocks),
      ...Object.keys(previousSubBlocks),
    ])

    for (const subId of allSubBlockIds) {
      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(subId) || SYSTEM_SUBBLOCK_IDS.includes(subId)) {
        continue
      }

      const currentSub = currentSubBlocks[subId]
      const previousSub = previousSubBlocks[subId]

      if (!currentSub || !previousSub) {
        changes.push({
          field: subId,
          oldValue: previousSub?.value ?? null,
          newValue: currentSub?.value ?? null,
        })
        continue
      }

      const currentValue = normalizeValue(currentSub.value ?? null)
      const previousValue = normalizeValue(previousSub.value ?? null)

      if (normalizedStringify(currentValue) !== normalizedStringify(previousValue)) {
        changes.push({ field: subId, oldValue: previousSub.value, newValue: currentSub.value })
      }
    }

    if (changes.length > 0) {
      result.modifiedBlocks.push({
        id,
        type: currentBlock.type,
        name: currentBlock.name,
        changes,
      })
    }
  }

  const currentEdges = (currentState.edges || []).map(normalizeEdge)
  const previousEdges = (previousState.edges || []).map(normalizeEdge)
  const currentEdgeSet = new Set(currentEdges.map(normalizedStringify))
  const previousEdgeSet = new Set(previousEdges.map(normalizedStringify))

  for (const edge of currentEdgeSet) {
    if (!previousEdgeSet.has(edge)) result.edgeChanges.added++
  }
  for (const edge of previousEdgeSet) {
    if (!currentEdgeSet.has(edge)) result.edgeChanges.removed++
  }

  const currentLoopIds = Object.keys(currentState.loops || {})
  const previousLoopIds = Object.keys(previousState.loops || {})
  result.loopChanges.added = currentLoopIds.filter((id) => !previousLoopIds.includes(id)).length
  result.loopChanges.removed = previousLoopIds.filter((id) => !currentLoopIds.includes(id)).length

  const currentParallelIds = Object.keys(currentState.parallels || {})
  const previousParallelIds = Object.keys(previousState.parallels || {})
  result.parallelChanges.added = currentParallelIds.filter(
    (id) => !previousParallelIds.includes(id)
  ).length
  result.parallelChanges.removed = previousParallelIds.filter(
    (id) => !currentParallelIds.includes(id)
  ).length

  const currentVars = currentState.variables || {}
  const previousVars = previousState.variables || {}
  const currentVarIds = Object.keys(currentVars)
  const previousVarIds = Object.keys(previousVars)

  result.variableChanges.added = currentVarIds.filter((id) => !previousVarIds.includes(id)).length
  result.variableChanges.removed = previousVarIds.filter((id) => !currentVarIds.includes(id)).length

  for (const id of currentVarIds) {
    if (!previousVarIds.includes(id)) continue
    const currentVar = normalizeValue(sanitizeVariable(currentVars[id]))
    const previousVar = normalizeValue(sanitizeVariable(previousVars[id]))
    if (normalizedStringify(currentVar) !== normalizedStringify(previousVar)) {
      result.variableChanges.modified++
    }
  }

  result.hasChanges =
    result.addedBlocks.length > 0 ||
    result.removedBlocks.length > 0 ||
    result.modifiedBlocks.length > 0 ||
    result.edgeChanges.added > 0 ||
    result.edgeChanges.removed > 0 ||
    result.loopChanges.added > 0 ||
    result.loopChanges.removed > 0 ||
    result.parallelChanges.added > 0 ||
    result.parallelChanges.removed > 0 ||
    result.variableChanges.added > 0 ||
    result.variableChanges.removed > 0 ||
    result.variableChanges.modified > 0

  return result
}

function formatValueForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '(none)'
  if (typeof value === 'string') {
    if (value.length > 50) return `${value.slice(0, 50)}...`
    return value || '(empty)'
  }
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return `${JSON.stringify(value).slice(0, 50)}...`
  return String(value)
}

/**
 * Convert a WorkflowDiffSummary to a human-readable string for AI description generation
 */
export function formatDiffSummaryForDescription(summary: WorkflowDiffSummary): string {
  if (!summary.hasChanges) {
    return 'No structural changes detected (configuration may have changed)'
  }

  const changes: string[] = []

  for (const block of summary.addedBlocks) {
    const name = block.name || block.type
    changes.push(`Added block: ${name} (${block.type})`)
  }

  for (const block of summary.removedBlocks) {
    const name = block.name || block.type
    changes.push(`Removed block: ${name} (${block.type})`)
  }

  for (const block of summary.modifiedBlocks) {
    const name = block.name || block.type
    for (const change of block.changes.slice(0, 3)) {
      const oldStr = formatValueForDisplay(change.oldValue)
      const newStr = formatValueForDisplay(change.newValue)
      changes.push(`Modified ${name}: ${change.field} changed from "${oldStr}" to "${newStr}"`)
    }
    if (block.changes.length > 3) {
      changes.push(`  ...and ${block.changes.length - 3} more changes in ${name}`)
    }
  }

  if (summary.edgeChanges.added > 0) {
    changes.push(`Added ${summary.edgeChanges.added} connection(s)`)
  }
  if (summary.edgeChanges.removed > 0) {
    changes.push(`Removed ${summary.edgeChanges.removed} connection(s)`)
  }

  if (summary.loopChanges.added > 0) {
    changes.push(`Added ${summary.loopChanges.added} loop(s)`)
  }
  if (summary.loopChanges.removed > 0) {
    changes.push(`Removed ${summary.loopChanges.removed} loop(s)`)
  }

  if (summary.parallelChanges.added > 0) {
    changes.push(`Added ${summary.parallelChanges.added} parallel group(s)`)
  }
  if (summary.parallelChanges.removed > 0) {
    changes.push(`Removed ${summary.parallelChanges.removed} parallel group(s)`)
  }

  const varChanges: string[] = []
  if (summary.variableChanges.added > 0) {
    varChanges.push(`${summary.variableChanges.added} added`)
  }
  if (summary.variableChanges.removed > 0) {
    varChanges.push(`${summary.variableChanges.removed} removed`)
  }
  if (summary.variableChanges.modified > 0) {
    varChanges.push(`${summary.variableChanges.modified} modified`)
  }
  if (varChanges.length > 0) {
    changes.push(`Variables: ${varChanges.join(', ')}`)
  }

  return changes.join('\n')
}
