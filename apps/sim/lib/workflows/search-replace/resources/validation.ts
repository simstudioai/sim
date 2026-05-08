import {
  getWorkflowSearchResourceKindLabel,
  isConstrainedWorkflowSearchResourceKind,
  normalizeWorkflowSearchResourceReplacement,
} from '@/lib/workflows/search-replace/resources/registry'
import { replacementOptionMatchesResourceMatch } from '@/lib/workflows/search-replace/resources/resolvers'
import type {
  WorkflowSearchMatch,
  WorkflowSearchReplacementOption,
} from '@/lib/workflows/search-replace/types'

export function isConstrainedResourceMatch(match: WorkflowSearchMatch): boolean {
  return isConstrainedWorkflowSearchResourceKind(match.kind)
}

export function getCompatibleResourceReplacementOptions(
  matches: WorkflowSearchMatch[],
  resourceOptions: WorkflowSearchReplacementOption[]
): WorkflowSearchReplacementOption[] {
  const constrainedMatches = matches.filter(isConstrainedResourceMatch)
  if (constrainedMatches.length === 0) return []

  const kinds = new Set(constrainedMatches.map((match) => match.kind))
  if (kinds.size !== 1) return []

  return resourceOptions.filter((option) =>
    constrainedMatches.every((match) => replacementOptionMatchesResourceMatch(option, match))
  )
}

export function getWorkflowSearchReplacementIssue({
  matches,
  replacement,
  resourceOptions = [],
}: {
  matches: WorkflowSearchMatch[]
  replacement: string
  resourceOptions?: WorkflowSearchReplacementOption[]
}): string | null {
  const editableMatches = matches.filter((match) => match.editable)
  const constrainedMatches = editableMatches.filter(isConstrainedResourceMatch)
  if (constrainedMatches.length === 0) return null

  if (editableMatches.length !== constrainedMatches.length) {
    return 'Replace references separately from text matches.'
  }

  const kinds = new Set(constrainedMatches.map((match) => match.kind))
  if (kinds.size !== 1) {
    return 'Replace one reference type at a time.'
  }

  const [firstMatch] = constrainedMatches
  const normalizedReplacement = normalizeWorkflowSearchResourceReplacement(firstMatch, replacement)
  const compatibleOptions = getCompatibleResourceReplacementOptions(
    constrainedMatches,
    resourceOptions
  )
  const hasResolvableReplacement = compatibleOptions.some(
    (option) => option.value === normalizedReplacement
  )

  if (hasResolvableReplacement) return null

  const label = getWorkflowSearchResourceKindLabel(firstMatch.kind)
  return `Choose a valid ${label} replacement.`
}
