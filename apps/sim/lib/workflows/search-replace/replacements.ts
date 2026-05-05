import { getWorkflowSearchReplacementIssue } from '@/lib/workflows/search-replace/replacement-validation'
import type {
  WorkflowSearchMatch,
  WorkflowSearchReplacementOption,
  WorkflowSearchReplacePlan,
  WorkflowSearchReplaceUpdate,
} from '@/lib/workflows/search-replace/types'
import {
  getValueAtPath,
  pathToKey,
  setValueAtPath,
} from '@/lib/workflows/search-replace/value-walker'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface BuildWorkflowSearchReplacePlanParams {
  blocks: Record<string, BlockState>
  matches: WorkflowSearchMatch[]
  selectedMatchIds: Set<string>
  replacementByMatchId?: Record<string, string>
  defaultReplacement?: string
  resourceReplacementOptions?: WorkflowSearchReplacementOption[]
}

function normalizeReplacement(match: WorkflowSearchMatch, replacement: string): string {
  if (match.kind === 'environment') {
    const trimmed = replacement.trim()
    if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return trimmed
    return `{{${trimmed}}}`
  }
  return replacement
}

function replaceRange(value: string, start: number, end: number, replacement: string): string {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`
}

function replaceStructuredValue(value: unknown, rawValue: string, replacement: string): unknown {
  if (typeof value === 'string') {
    const parts = value.split(',').map((part) => part.trim())
    if (parts.length > 1) {
      return parts.map((part) => (part === rawValue ? replacement : part)).join(',')
    }
    return value === rawValue ? replacement : value
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' && item === rawValue
        ? replacement
        : replaceStructuredValue(item, rawValue, replacement)
    )
  }

  return value
}

function structuredValueContains(value: unknown, rawValue: string): boolean {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .includes(rawValue)
  }
  if (Array.isArray(value)) {
    return value.some((item) => structuredValueContains(item, rawValue))
  }
  return false
}

function getReplacement(
  match: WorkflowSearchMatch,
  replacementByMatchId: Record<string, string> | undefined,
  defaultReplacement: string | undefined
): string | undefined {
  const replacement = replacementByMatchId?.[match.id] ?? defaultReplacement
  if (replacement === undefined) return undefined
  return normalizeReplacement(match, replacement)
}

export function buildWorkflowSearchReplacePlan({
  blocks,
  matches,
  selectedMatchIds,
  replacementByMatchId,
  defaultReplacement,
  resourceReplacementOptions,
}: BuildWorkflowSearchReplacePlanParams): WorkflowSearchReplacePlan {
  const skipped: WorkflowSearchReplacePlan['skipped'] = []
  const conflicts: WorkflowSearchReplacePlan['conflicts'] = []
  const updatesByField = new Map<string, WorkflowSearchReplaceUpdate>()

  const selectedMatches = matches.filter((match) => selectedMatchIds.has(match.id))
  const orderedMatches = [...selectedMatches].sort((a, b) => {
    const blockCompare = a.blockId.localeCompare(b.blockId)
    if (blockCompare !== 0) return blockCompare
    const subBlockCompare = a.subBlockId.localeCompare(b.subBlockId)
    if (subBlockCompare !== 0) return subBlockCompare
    const pathCompare = pathToKey(a.valuePath).localeCompare(pathToKey(b.valuePath))
    if (pathCompare !== 0) return pathCompare
    return (b.range?.start ?? 0) - (a.range?.start ?? 0)
  })

  for (const match of orderedMatches) {
    const replacement = getReplacement(match, replacementByMatchId, defaultReplacement)
    if (replacement === undefined || replacement === match.rawValue) {
      skipped.push({ matchId: match.id, reason: 'No replacement value provided' })
      continue
    }

    if (!match.editable) {
      skipped.push({ matchId: match.id, reason: match.reason ?? 'Match is not editable' })
      continue
    }

    const replacementIssue = getWorkflowSearchReplacementIssue({
      matches: [match],
      replacement,
      resourceOptions: resourceReplacementOptions,
    })
    if (replacementIssue) {
      conflicts.push({ matchId: match.id, reason: replacementIssue })
      continue
    }

    const block = blocks[match.blockId]
    const subBlock = block?.subBlocks?.[match.subBlockId]
    if (!block || !subBlock) {
      conflicts.push({ matchId: match.id, reason: 'Block or subblock no longer exists' })
      continue
    }

    const updateKey = `${match.blockId}:${match.subBlockId}`
    const existingUpdate = updatesByField.get(updateKey)
    const previousValue: unknown = existingUpdate?.previousValue ?? subBlock.value
    let nextValue: unknown = existingUpdate?.nextValue ?? subBlock.value

    if (match.range) {
      const currentLeaf = getValueAtPath(nextValue, match.valuePath)
      if (typeof currentLeaf !== 'string') {
        conflicts.push({ matchId: match.id, reason: 'Target value is no longer text' })
        continue
      }

      const currentRawValue = currentLeaf.slice(match.range.start, match.range.end)
      if (currentRawValue !== match.rawValue) {
        conflicts.push({ matchId: match.id, reason: 'Target text changed since search' })
        continue
      }

      nextValue = setValueAtPath(
        nextValue,
        match.valuePath,
        replaceRange(currentLeaf, match.range.start, match.range.end, replacement)
      )
    } else {
      const currentValue = getValueAtPath(nextValue, match.valuePath)
      const valueForReplacement = match.valuePath.length === 0 ? nextValue : currentValue
      if (!structuredValueContains(valueForReplacement, match.rawValue)) {
        conflicts.push({ matchId: match.id, reason: 'Target resource changed since search' })
        continue
      }

      const replacedValue = replaceStructuredValue(valueForReplacement, match.rawValue, replacement)
      nextValue =
        match.valuePath.length === 0
          ? replacedValue
          : setValueAtPath(nextValue, match.valuePath, replacedValue)
    }

    updatesByField.set(updateKey, {
      blockId: match.blockId,
      subBlockId: match.subBlockId,
      previousValue,
      nextValue,
      matchIds: [...(existingUpdate?.matchIds ?? []), match.id],
    })
  }

  if (conflicts.length > 0) {
    return { updates: [], skipped, conflicts }
  }

  return {
    updates: [...updatesByField.values()].filter(
      (update) => update.previousValue !== update.nextValue
    ),
    skipped,
    conflicts,
  }
}
