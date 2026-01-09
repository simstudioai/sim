import type { WorkflowState } from '@/stores/workflows/workflow/types'
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
    const {
      position: _currentPos,
      subBlocks: currentSubBlocks = {},
      layout: _currentLayout,
      height: _currentHeight,
      ...currentRest
    } = currentBlock

    const {
      position: _deployedPos,
      subBlocks: deployedSubBlocks = {},
      layout: _deployedLayout,
      height: _deployedHeight,
      ...deployedRest
    } = deployedBlock

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

      // Compare type and other properties
      const currentSubBlockWithoutValue = { ...currentSubBlocks[subBlockId], value: undefined }
      const deployedSubBlockWithoutValue = { ...deployedSubBlocks[subBlockId], value: undefined }

      if (
        normalizedStringify(currentSubBlockWithoutValue) !==
        normalizedStringify(deployedSubBlockWithoutValue)
      ) {
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
