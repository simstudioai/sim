import { createLogger } from '@sim/logger'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  extractBlockFieldsForComparison,
  extractSubBlockRest,
  filterSubBlockIds,
  normalizedStringify,
  normalizeEdge,
  normalizeLoop,
  normalizeParallel,
  normalizeSubBlockValue,
  normalizeValue,
  normalizeVariables,
  sanitizeVariable,
} from './normalize'
import { formatValueForDisplay, resolveValueForDisplay } from './resolve-values'

const logger = createLogger('WorkflowComparison')

/**
 * Compare the current workflow state with the deployed state to detect meaningful changes.
 * Uses generateWorkflowDiffSummary internally to ensure consistent change detection.
 */
export function hasWorkflowChanged(
  currentState: WorkflowState,
  deployedState: WorkflowState | null
): boolean {
  return generateWorkflowDiffSummary(currentState, deployedState).hasChanges
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
  loopChanges: { added: number; removed: number; modified: number }
  parallelChanges: { added: number; removed: number; modified: number }
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
    loopChanges: { added: 0, removed: 0, modified: 0 },
    parallelChanges: { added: 0, removed: 0, modified: 0 },
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

    const currentBlock = currentBlocks[id]
    const previousBlock = previousBlocks[id]
    const changes: FieldChange[] = []

    // Use shared helpers for block field extraction (single source of truth)
    const {
      blockRest: currentRest,
      normalizedData: currentDataRest,
      subBlocks: currentSubBlocks,
    } = extractBlockFieldsForComparison(currentBlock)
    const {
      blockRest: previousRest,
      normalizedData: previousDataRest,
      subBlocks: previousSubBlocks,
    } = extractBlockFieldsForComparison(previousBlock)

    const normalizedCurrentBlock = { ...currentRest, data: currentDataRest, subBlocks: undefined }
    const normalizedPreviousBlock = {
      ...previousRest,
      data: previousDataRest,
      subBlocks: undefined,
    }

    if (
      normalizedStringify(normalizedCurrentBlock) !== normalizedStringify(normalizedPreviousBlock)
    ) {
      if (currentBlock.type !== previousBlock.type) {
        changes.push({ field: 'type', oldValue: previousBlock.type, newValue: currentBlock.type })
      }
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
      // Check other block properties (boolean fields)
      // Use !! to normalize: null/undefined/false are all equivalent (falsy)
      const blockFields = ['horizontalHandles', 'advancedMode', 'triggerMode', 'locked'] as const
      for (const field of blockFields) {
        if (!!currentBlock[field] !== !!previousBlock[field]) {
          changes.push({
            field,
            oldValue: previousBlock[field],
            newValue: currentBlock[field],
          })
        }
      }
      if (normalizedStringify(currentDataRest) !== normalizedStringify(previousDataRest)) {
        changes.push({ field: 'data', oldValue: previousDataRest, newValue: currentDataRest })
      }
    }

    // Compare subBlocks using shared helper for filtering (single source of truth)
    const allSubBlockIds = filterSubBlockIds([
      ...new Set([...Object.keys(currentSubBlocks), ...Object.keys(previousSubBlocks)]),
    ])

    for (const subId of allSubBlockIds) {
      const currentSub = currentSubBlocks[subId] as Record<string, unknown> | undefined
      const previousSub = previousSubBlocks[subId] as Record<string, unknown> | undefined

      if (!currentSub || !previousSub) {
        changes.push({
          field: subId,
          oldValue: (previousSub as Record<string, unknown> | undefined)?.value ?? null,
          newValue: (currentSub as Record<string, unknown> | undefined)?.value ?? null,
        })
        continue
      }

      // Use shared helper for subBlock value normalization (single source of truth)
      const currentValue = normalizeSubBlockValue(subId, currentSub.value)
      const previousValue = normalizeSubBlockValue(subId, previousSub.value)

      // For string values, compare directly to catch even small text changes
      if (typeof currentValue === 'string' && typeof previousValue === 'string') {
        if (currentValue !== previousValue) {
          changes.push({ field: subId, oldValue: previousSub.value, newValue: currentSub.value })
        }
      } else {
        const normalizedCurrent = normalizeValue(currentValue)
        const normalizedPrevious = normalizeValue(previousValue)
        if (normalizedStringify(normalizedCurrent) !== normalizedStringify(normalizedPrevious)) {
          changes.push({ field: subId, oldValue: previousSub.value, newValue: currentSub.value })
        }
      }

      // Use shared helper for subBlock REST extraction (single source of truth)
      const currentSubRest = extractSubBlockRest(currentSub)
      const previousSubRest = extractSubBlockRest(previousSub)

      if (normalizedStringify(currentSubRest) !== normalizedStringify(previousSubRest)) {
        changes.push({
          field: `${subId}.properties`,
          oldValue: previousSubRest,
          newValue: currentSubRest,
        })
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

  const currentLoops = currentState.loops || {}
  const previousLoops = previousState.loops || {}
  const currentLoopIds = Object.keys(currentLoops)
  const previousLoopIds = Object.keys(previousLoops)

  for (const id of currentLoopIds) {
    if (!previousLoopIds.includes(id)) {
      result.loopChanges.added++
    } else {
      const normalizedCurrent = normalizeValue(normalizeLoop(currentLoops[id]))
      const normalizedPrevious = normalizeValue(normalizeLoop(previousLoops[id]))
      if (normalizedStringify(normalizedCurrent) !== normalizedStringify(normalizedPrevious)) {
        result.loopChanges.modified++
      }
    }
  }
  for (const id of previousLoopIds) {
    if (!currentLoopIds.includes(id)) {
      result.loopChanges.removed++
    }
  }

  const currentParallels = currentState.parallels || {}
  const previousParallels = previousState.parallels || {}
  const currentParallelIds = Object.keys(currentParallels)
  const previousParallelIds = Object.keys(previousParallels)

  for (const id of currentParallelIds) {
    if (!previousParallelIds.includes(id)) {
      result.parallelChanges.added++
    } else {
      const normalizedCurrent = normalizeValue(normalizeParallel(currentParallels[id]))
      const normalizedPrevious = normalizeValue(normalizeParallel(previousParallels[id]))
      if (normalizedStringify(normalizedCurrent) !== normalizedStringify(normalizedPrevious)) {
        result.parallelChanges.modified++
      }
    }
  }
  for (const id of previousParallelIds) {
    if (!currentParallelIds.includes(id)) {
      result.parallelChanges.removed++
    }
  }

  const currentVars = normalizeVariables(currentState.variables)
  const previousVars = normalizeVariables(previousState.variables)
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
    result.loopChanges.modified > 0 ||
    result.parallelChanges.added > 0 ||
    result.parallelChanges.removed > 0 ||
    result.parallelChanges.modified > 0 ||
    result.variableChanges.added > 0 ||
    result.variableChanges.removed > 0 ||
    result.variableChanges.modified > 0

  return result
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
  if (summary.loopChanges.modified > 0) {
    changes.push(`Modified ${summary.loopChanges.modified} loop(s)`)
  }

  if (summary.parallelChanges.added > 0) {
    changes.push(`Added ${summary.parallelChanges.added} parallel group(s)`)
  }
  if (summary.parallelChanges.removed > 0) {
    changes.push(`Removed ${summary.parallelChanges.removed} parallel group(s)`)
  }
  if (summary.parallelChanges.modified > 0) {
    changes.push(`Modified ${summary.parallelChanges.modified} parallel group(s)`)
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

/**
 * Converts a WorkflowDiffSummary to a human-readable string with resolved display names.
 * Resolves IDs (credentials, channels, workflows, etc.) to human-readable names using
 * the selector registry infrastructure.
 *
 * @param summary - The diff summary to format
 * @param currentState - The current workflow state for context extraction
 * @param workflowId - The workflow ID for API calls
 * @returns A formatted string describing the changes with resolved names
 */
export async function formatDiffSummaryForDescriptionAsync(
  summary: WorkflowDiffSummary,
  currentState: WorkflowState,
  workflowId: string
): Promise<string> {
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

  const modifiedBlockPromises = summary.modifiedBlocks.map(async (block) => {
    const name = block.name || block.type
    const blockChanges: string[] = []

    const changesToProcess = block.changes.slice(0, 3)
    const resolvedChanges = await Promise.all(
      changesToProcess.map(async (change) => {
        const context = {
          blockType: block.type,
          subBlockId: change.field,
          workflowId,
          currentState,
          blockId: block.id,
        }

        const [oldResolved, newResolved] = await Promise.all([
          resolveValueForDisplay(change.oldValue, context),
          resolveValueForDisplay(change.newValue, context),
        ])

        return {
          field: change.field,
          oldLabel: oldResolved.displayLabel,
          newLabel: newResolved.displayLabel,
        }
      })
    )

    for (const resolved of resolvedChanges) {
      blockChanges.push(
        `Modified ${name}: ${resolved.field} changed from "${resolved.oldLabel}" to "${resolved.newLabel}"`
      )
    }

    if (block.changes.length > 3) {
      blockChanges.push(`  ...and ${block.changes.length - 3} more changes in ${name}`)
    }

    return blockChanges
  })

  const allModifiedBlockChanges = await Promise.all(modifiedBlockPromises)
  for (const blockChanges of allModifiedBlockChanges) {
    changes.push(...blockChanges)
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
  if (summary.loopChanges.modified > 0) {
    changes.push(`Modified ${summary.loopChanges.modified} loop(s)`)
  }

  if (summary.parallelChanges.added > 0) {
    changes.push(`Added ${summary.parallelChanges.added} parallel group(s)`)
  }
  if (summary.parallelChanges.removed > 0) {
    changes.push(`Removed ${summary.parallelChanges.removed} parallel group(s)`)
  }
  if (summary.parallelChanges.modified > 0) {
    changes.push(`Modified ${summary.parallelChanges.modified} parallel group(s)`)
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

  logger.info('Generated async diff description', {
    workflowId,
    changeCount: changes.length,
    modifiedBlocks: summary.modifiedBlocks.length,
  })

  return changes.join('\n')
}
