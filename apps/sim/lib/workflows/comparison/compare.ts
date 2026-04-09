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
  normalizeTriggerConfigValues,
  normalizeValue,
  normalizeVariables,
  sanitizeVariable,
} from './normalize'
import { formatValueForDisplay, resolveFieldLabel, resolveValueForDisplay } from './resolve-values'

const MAX_CHANGES_PER_BLOCK = 6
const MAX_EDGE_DETAILS = 3

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
  edgeChanges: {
    added: number
    removed: number
    addedDetails: Array<{ sourceName: string; targetName: string }>
    removedDetails: Array<{ sourceName: string; targetName: string }>
  }
  loopChanges: { added: number; removed: number; modified: number }
  parallelChanges: { added: number; removed: number; modified: number }
  variableChanges: {
    added: number
    removed: number
    modified: number
    addedNames: string[]
    removedNames: string[]
    modifiedNames: string[]
  }
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
    edgeChanges: { added: 0, removed: 0, addedDetails: [], removedDetails: [] },
    loopChanges: { added: 0, removed: 0, modified: 0 },
    parallelChanges: { added: 0, removed: 0, modified: 0 },
    variableChanges: {
      added: 0,
      removed: 0,
      modified: 0,
      addedNames: [],
      removedNames: [],
      modifiedNames: [],
    },
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

    const edges = currentState.edges || []
    result.edgeChanges.added = edges.length
    for (const edge of edges) {
      const sourceBlock = currentBlocks[edge.source]
      const targetBlock = currentBlocks[edge.target]
      result.edgeChanges.addedDetails.push({
        sourceName: sourceBlock?.name || sourceBlock?.type || edge.source,
        targetName: targetBlock?.name || targetBlock?.type || edge.target,
      })
    }

    result.loopChanges.added = Object.keys(currentState.loops || {}).length
    result.parallelChanges.added = Object.keys(currentState.parallels || {}).length

    const variables = currentState.variables || {}
    const varEntries = Object.entries(variables)
    result.variableChanges.added = varEntries.length
    for (const [id, variable] of varEntries) {
      result.variableChanges.addedNames.push((variable as { name?: string }).name || id)
    }

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
        const allDataKeys = new Set([
          ...Object.keys(currentDataRest),
          ...Object.keys(previousDataRest),
        ])
        for (const key of allDataKeys) {
          if (
            normalizedStringify(currentDataRest[key]) !== normalizedStringify(previousDataRest[key])
          ) {
            changes.push({
              field: `data.${key}`,
              oldValue: previousDataRest[key] ?? null,
              newValue: currentDataRest[key] ?? null,
            })
          }
        }
      }
    }

    const normalizedCurrentSubs = normalizeTriggerConfigValues(currentSubBlocks)
    const normalizedPreviousSubs = normalizeTriggerConfigValues(previousSubBlocks)

    const allSubBlockIds = filterSubBlockIds([
      ...new Set([...Object.keys(normalizedCurrentSubs), ...Object.keys(normalizedPreviousSubs)]),
    ])

    for (const subId of allSubBlockIds) {
      const currentSub = normalizedCurrentSubs[subId] as Record<string, unknown> | undefined
      const previousSub = normalizedPreviousSubs[subId] as Record<string, unknown> | undefined

      if (!currentSub || !previousSub) {
        changes.push({
          field: subId,
          oldValue: (previousSub as Record<string, unknown> | undefined)?.value ?? null,
          newValue: (currentSub as Record<string, unknown> | undefined)?.value ?? null,
        })
        continue
      }

      const currentValue = normalizeSubBlockValue(subId, currentSub.value)
      const previousValue = normalizeSubBlockValue(subId, previousSub.value)

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

  const resolveBlockName = (blockId: string): string => {
    const block = currentBlocks[blockId] || previousBlocks[blockId]
    return block?.name || block?.type || blockId
  }

  for (const edgeStr of currentEdgeSet) {
    if (!previousEdgeSet.has(edgeStr)) {
      result.edgeChanges.added++
      const edge = JSON.parse(edgeStr) as { source: string; target: string }
      result.edgeChanges.addedDetails.push({
        sourceName: resolveBlockName(edge.source),
        targetName: resolveBlockName(edge.target),
      })
    }
  }
  for (const edgeStr of previousEdgeSet) {
    if (!currentEdgeSet.has(edgeStr)) {
      result.edgeChanges.removed++
      const edge = JSON.parse(edgeStr) as { source: string; target: string }
      result.edgeChanges.removedDetails.push({
        sourceName: resolveBlockName(edge.source),
        targetName: resolveBlockName(edge.target),
      })
    }
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

  for (const id of currentVarIds) {
    if (!previousVarIds.includes(id)) {
      result.variableChanges.added++
      result.variableChanges.addedNames.push(currentVars[id].name || id)
    }
  }
  for (const id of previousVarIds) {
    if (!currentVarIds.includes(id)) {
      result.variableChanges.removed++
      result.variableChanges.removedNames.push(previousVars[id].name || id)
    }
  }

  for (const id of currentVarIds) {
    if (!previousVarIds.includes(id)) continue
    const currentVar = normalizeValue(sanitizeVariable(currentVars[id]))
    const previousVar = normalizeValue(sanitizeVariable(previousVars[id]))
    if (normalizedStringify(currentVar) !== normalizedStringify(previousVar)) {
      result.variableChanges.modified++
      result.variableChanges.modifiedNames.push(currentVars[id].name || id)
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
    const meaningfulChanges = block.changes.filter((c) => !c.field.endsWith('.properties'))
    for (const change of meaningfulChanges.slice(0, MAX_CHANGES_PER_BLOCK)) {
      const fieldLabel = resolveFieldLabel(block.type, change.field)
      const oldStr = formatValueForDisplay(change.oldValue)
      const newStr = formatValueForDisplay(change.newValue)
      changes.push(`Modified ${name}: ${fieldLabel} changed from "${oldStr}" to "${newStr}"`)
    }
    if (meaningfulChanges.length > MAX_CHANGES_PER_BLOCK) {
      changes.push(
        `  ...and ${meaningfulChanges.length - MAX_CHANGES_PER_BLOCK} more changes in ${name}`
      )
    }
  }

  formatEdgeChanges(summary, changes)
  formatCountChanges(summary.loopChanges, 'loop', changes)
  formatCountChanges(summary.parallelChanges, 'parallel group', changes)
  formatVariableChanges(summary, changes)

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
    const meaningfulChanges = block.changes.filter((c) => !c.field.endsWith('.properties'))

    const changesToProcess = meaningfulChanges.slice(0, MAX_CHANGES_PER_BLOCK)
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
          field: resolveFieldLabel(block.type, change.field),
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

    if (meaningfulChanges.length > MAX_CHANGES_PER_BLOCK) {
      blockChanges.push(
        `  ...and ${meaningfulChanges.length - MAX_CHANGES_PER_BLOCK} more changes in ${name}`
      )
    }

    return blockChanges
  })

  const allModifiedBlockChanges = await Promise.all(modifiedBlockPromises)
  for (const blockChanges of allModifiedBlockChanges) {
    changes.push(...blockChanges)
  }

  formatEdgeChanges(summary, changes)
  formatCountChanges(summary.loopChanges, 'loop', changes)
  formatCountChanges(summary.parallelChanges, 'parallel group', changes)
  formatVariableChanges(summary, changes)

  logger.info('Generated async diff description', {
    workflowId,
    changeCount: changes.length,
    modifiedBlocks: summary.modifiedBlocks.length,
  })

  return changes.join('\n')
}

function formatEdgeDetailList(
  edges: Array<{ sourceName: string; targetName: string }>,
  total: number,
  verb: string,
  changes: string[]
): void {
  if (edges.length === 0) {
    changes.push(`${verb} ${total} connection(s)`)
    return
  }
  for (const edge of edges.slice(0, MAX_EDGE_DETAILS)) {
    changes.push(`${verb} connection: ${edge.sourceName} -> ${edge.targetName}`)
  }
  if (total > MAX_EDGE_DETAILS) {
    changes.push(`  ...and ${total - MAX_EDGE_DETAILS} more ${verb.toLowerCase()} connection(s)`)
  }
}

function formatEdgeChanges(summary: WorkflowDiffSummary, changes: string[]): void {
  if (summary.edgeChanges.added > 0) {
    formatEdgeDetailList(
      summary.edgeChanges.addedDetails ?? [],
      summary.edgeChanges.added,
      'Added',
      changes
    )
  }
  if (summary.edgeChanges.removed > 0) {
    formatEdgeDetailList(
      summary.edgeChanges.removedDetails ?? [],
      summary.edgeChanges.removed,
      'Removed',
      changes
    )
  }
}

function formatCountChanges(
  counts: { added: number; removed: number; modified: number },
  label: string,
  changes: string[]
): void {
  if (counts.added > 0) changes.push(`Added ${counts.added} ${label}(s)`)
  if (counts.removed > 0) changes.push(`Removed ${counts.removed} ${label}(s)`)
  if (counts.modified > 0) changes.push(`Modified ${counts.modified} ${label}(s)`)
}

function formatVariableChanges(summary: WorkflowDiffSummary, changes: string[]): void {
  const categories = [
    {
      count: summary.variableChanges.added,
      names: summary.variableChanges.addedNames ?? [],
      verb: 'added',
    },
    {
      count: summary.variableChanges.removed,
      names: summary.variableChanges.removedNames ?? [],
      verb: 'removed',
    },
    {
      count: summary.variableChanges.modified,
      names: summary.variableChanges.modifiedNames ?? [],
      verb: 'modified',
    },
  ] as const

  const varParts: string[] = []
  for (const { count, names, verb } of categories) {
    if (count > 0) {
      varParts.push(
        names.length > 0 ? `${verb} ${names.map((n) => `"${n}"`).join(', ')}` : `${count} ${verb}`
      )
    }
  }
  if (varParts.length > 0) {
    changes.push(`Variables: ${varParts.join(', ')}`)
  }
}
