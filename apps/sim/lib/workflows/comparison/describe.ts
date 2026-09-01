import { createLogger } from '@sim/logger'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import {
  formatValueForDisplay,
  resolveFieldLabel,
  resolveValueForDisplay,
} from '@/lib/workflows/comparison/resolve-values'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Renders a diff summary as prose.
 *
 * Deliberately separate from `compare.ts`: resolving an id to a human-readable
 * name reaches the block registry, the selector registry and the network, and
 * `apps/sim` does not declare `sideEffects: false`, so a barrel re-export would
 * keep that whole graph alive for every consumer of the comparison — including
 * two server modules that only ever ask the yes/no question.
 */

const MAX_CHANGES_PER_BLOCK = 6
const MAX_EDGE_DETAILS = 3

const logger = createLogger('WorkflowDescribe')

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
