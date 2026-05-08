import { getWorkflowSearchReplacementIssue } from '@/lib/workflows/search-replace/replacement-validation'
import {
  getWorkflowSearchSubflowField,
  parseWorkflowSearchSubflowReplacement,
} from '@/lib/workflows/search-replace/subflow-fields'
import type {
  WorkflowSearchBlockState,
  WorkflowSearchMatch,
  WorkflowSearchReplacementOption,
  WorkflowSearchReplacePlan,
  WorkflowSearchReplaceSubflowUpdate,
  WorkflowSearchReplaceUpdate,
} from '@/lib/workflows/search-replace/types'
import {
  getValueAtPath,
  pathToKey,
  setValueAtPath,
} from '@/lib/workflows/search-replace/value-walker'

interface BuildWorkflowSearchReplacePlanParams {
  blocks: Record<string, WorkflowSearchBlockState>
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

function replaceStructuredValue(
  value: unknown,
  rawValue: string,
  replacement: string,
  targetOccurrenceIndex?: number
): unknown {
  let occurrenceIndex = 0

  const shouldReplace = (item: string) => {
    if (item !== rawValue) return false
    const currentOccurrenceIndex = occurrenceIndex
    occurrenceIndex += 1
    return targetOccurrenceIndex === undefined || currentOccurrenceIndex === targetOccurrenceIndex
  }

  if (typeof value === 'string') {
    const parts = value.split(',').map((part) => part.trim())
    if (parts.length > 1) {
      return parts.map((part) => (shouldReplace(part) ? replacement : part)).join(',')
    }
    return shouldReplace(value) ? replacement : value
  }

  if (Array.isArray(value)) {
    const replaceItem = (item: unknown): unknown => {
      if (typeof item === 'string') {
        return shouldReplace(item) ? replacement : item
      }
      if (Array.isArray(item)) return item.map(replaceItem)
      return item
    }

    return value.map(replaceItem)
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
  const subflowUpdatesByField = new Map<string, WorkflowSearchReplaceSubflowUpdate>()

  const selectedMatches = matches.filter((match) => selectedMatchIds.has(match.id))
  const orderedMatches = [...selectedMatches].sort((a, b) => {
    const blockCompare = a.blockId.localeCompare(b.blockId)
    if (blockCompare !== 0) return blockCompare
    const subBlockCompare = a.subBlockId.localeCompare(b.subBlockId)
    if (subBlockCompare !== 0) return subBlockCompare
    const pathCompare = pathToKey(a.valuePath).localeCompare(pathToKey(b.valuePath))
    if (pathCompare !== 0) return pathCompare
    const occurrenceCompare =
      (b.structuredOccurrenceIndex ?? 0) - (a.structuredOccurrenceIndex ?? 0)
    if (occurrenceCompare !== 0) return occurrenceCompare
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
    if (!block) {
      conflicts.push({ matchId: match.id, reason: 'Block no longer exists' })
      continue
    }

    if (match.target.kind === 'subflow') {
      if (block.type !== 'loop' && block.type !== 'parallel') {
        conflicts.push({ matchId: match.id, reason: 'Subflow block no longer exists' })
        continue
      }

      const currentField = getWorkflowSearchSubflowField(block, match.target.fieldId)
      if (!currentField) {
        conflicts.push({ matchId: match.id, reason: 'Subflow field is no longer available' })
        continue
      }

      if (!currentField.editable) {
        conflicts.push({
          matchId: match.id,
          reason: currentField.reason ?? 'Subflow field is not editable',
        })
        continue
      }

      const updateKey = `${match.blockId}:${match.target.fieldId}`
      const existingUpdate = subflowUpdatesByField.get(updateKey)
      const previousValue = existingUpdate?.previousValue ?? currentField.value
      const currentValue = String(existingUpdate?.nextValue ?? currentField.value)

      if (!match.range) {
        conflicts.push({ matchId: match.id, reason: 'Subflow target is no longer text' })
        continue
      }

      const currentRawValue = currentValue.slice(match.range.start, match.range.end)
      if (currentRawValue !== match.rawValue) {
        conflicts.push({ matchId: match.id, reason: 'Subflow target changed since search' })
        continue
      }

      const nextTextValue = replaceRange(
        currentValue,
        match.range.start,
        match.range.end,
        replacement
      )
      const parsedReplacement = parseWorkflowSearchSubflowReplacement({
        blockType: block.type,
        fieldId: match.target.fieldId,
        replacement: nextTextValue,
      })
      if (!parsedReplacement.success) {
        conflicts.push({ matchId: match.id, reason: parsedReplacement.reason })
        continue
      }

      subflowUpdatesByField.set(updateKey, {
        blockId: match.blockId,
        blockType: block.type,
        fieldId: match.target.fieldId,
        previousValue,
        nextValue: parsedReplacement.value,
        matchIds: [...(existingUpdate?.matchIds ?? []), match.id],
      })
      continue
    }

    const subBlock = block?.subBlocks?.[match.subBlockId]
    if (!subBlock) {
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

      const replacedValue = replaceStructuredValue(
        valueForReplacement,
        match.rawValue,
        replacement,
        match.structuredOccurrenceIndex
      )
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
    return { updates: [], subflowUpdates: [], skipped, conflicts }
  }

  return {
    updates: [...updatesByField.values()].filter(
      (update) => update.previousValue !== update.nextValue
    ),
    subflowUpdates: [...subflowUpdatesByField.values()].filter((update) => {
      if (typeof update.nextValue === 'number')
        return String(update.nextValue) !== update.previousValue
      return update.nextValue !== update.previousValue
    }),
    skipped,
    conflicts,
  }
}
