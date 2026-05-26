import type { WorkflowSearchTextHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'

interface ActiveSearchHighlightOptions {
  activeSearchTarget?: ActiveSearchTarget | null
  blockId?: string
  subBlockId: string
  canonicalSubBlockId?: string
  valuePath?: Array<string | number>
  targetKind?: ActiveSearchTarget['targetKind']
}

export function workflowSearchPathsEqual(
  left: Array<string | number>,
  right: Array<string | number>
): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

export function isWorkflowSearchTargetForField({
  activeSearchTarget,
  blockId,
  subBlockId,
  canonicalSubBlockId,
  valuePath = [],
  targetKind = 'subblock',
}: ActiveSearchHighlightOptions): boolean {
  if (!activeSearchTarget || activeSearchTarget.targetKind !== targetKind) return false
  if (blockId !== undefined && activeSearchTarget.blockId !== blockId) return false
  const matchesSubBlock =
    activeSearchTarget.subBlockId === subBlockId ||
    (canonicalSubBlockId !== undefined &&
      activeSearchTarget.canonicalSubBlockId === canonicalSubBlockId)
  return matchesSubBlock && workflowSearchPathsEqual(activeSearchTarget.valuePath, valuePath)
}

export function getActiveWorkflowSearchHighlight(
  options: ActiveSearchHighlightOptions
): WorkflowSearchTextHighlight | null {
  if (!isWorkflowSearchTargetForField(options)) return null
  const { activeSearchTarget } = options
  if (!activeSearchTarget?.range) return null
  return {
    range: activeSearchTarget.range,
    rawValue: activeSearchTarget.rawValue,
  }
}

function findCaseInsensitiveOriginalRange(
  label: string,
  query: string
): WorkflowSearchTextHighlight | null {
  const normalizedLabel = label.toLowerCase()
  const normalizedQuery = query.toLowerCase()
  const normalizedStart = normalizedLabel.indexOf(normalizedQuery)
  if (normalizedStart < 0) return null

  const normalizedEnd = normalizedStart + normalizedQuery.length
  let normalizedOffset = 0
  let originalStart: number | undefined
  let originalEnd: number | undefined

  for (let originalIndex = 0; originalIndex < label.length; ) {
    const codePoint = label.codePointAt(originalIndex)
    if (codePoint === undefined) break
    const character = String.fromCodePoint(codePoint)
    const nextOriginalIndex = originalIndex + character.length
    const nextNormalizedOffset = normalizedOffset + character.toLowerCase().length

    if (originalStart === undefined && normalizedStart < nextNormalizedOffset) {
      originalStart = originalIndex
    }
    if (originalStart !== undefined && normalizedEnd <= nextNormalizedOffset) {
      originalEnd = nextOriginalIndex
      break
    }

    originalIndex = nextOriginalIndex
    normalizedOffset = nextNormalizedOffset
  }

  if (originalStart === undefined || originalEnd === undefined || originalEnd <= originalStart) {
    return null
  }

  return {
    range: { start: originalStart, end: originalEnd },
    rawValue: label.slice(originalStart, originalEnd),
  }
}

export function getWorkflowSearchLabelHighlight(
  options: ActiveSearchHighlightOptions & { label: string }
): WorkflowSearchTextHighlight | null {
  if (!isWorkflowSearchTargetForField(options)) return null
  const { activeSearchTarget, label } = options
  if (!activeSearchTarget || label.length === 0) return null
  if (activeSearchTarget.range) {
    const { range, rawValue } = activeSearchTarget
    if (
      rawValue &&
      range.start >= 0 &&
      range.end > range.start &&
      range.end <= label.length &&
      label.slice(range.start, range.end) === rawValue
    ) {
      return { range, rawValue }
    }
  }

  const trimmedQuery = activeSearchTarget.query.trim()
  if (trimmedQuery) {
    return findCaseInsensitiveOriginalRange(label, trimmedQuery)
  }

  return null
}
