import { replacementOptionMatchesResourceMatch } from '@/lib/workflows/search-replace/resource-resolvers'
import type {
  WorkflowSearchMatch,
  WorkflowSearchMatchKind,
  WorkflowSearchReplacementOption,
} from '@/lib/workflows/search-replace/types'

const CONSTRAINED_RESOURCE_KINDS = new Set<WorkflowSearchMatchKind>([
  'environment',
  'oauth-credential',
  'knowledge-base',
  'knowledge-document',
  'workflow',
  'mcp-server',
  'mcp-tool',
  'table',
  'file',
  'selector-resource',
])

const RESOURCE_KIND_LABELS: Partial<Record<WorkflowSearchMatchKind, string>> = {
  environment: 'environment variable',
  'oauth-credential': 'OAuth credential',
  'knowledge-base': 'knowledge base',
  'knowledge-document': 'knowledge document',
  workflow: 'workflow',
  'mcp-server': 'MCP server',
  'mcp-tool': 'MCP tool',
  table: 'table',
  file: 'file',
  'selector-resource': 'selector resource',
}

export function isConstrainedResourceMatch(match: WorkflowSearchMatch): boolean {
  return CONSTRAINED_RESOURCE_KINDS.has(match.kind)
}

function normalizeResourceReplacement(match: WorkflowSearchMatch, replacement: string): string {
  if (match.kind !== 'environment') return replacement

  const trimmed = replacement.trim()
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return trimmed
  return `{{${trimmed}}}`
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
  const normalizedReplacement = normalizeResourceReplacement(firstMatch, replacement)
  const compatibleOptions = getCompatibleResourceReplacementOptions(
    constrainedMatches,
    resourceOptions
  )
  const hasResolvableReplacement = compatibleOptions.some(
    (option) => option.value === normalizedReplacement
  )

  if (hasResolvableReplacement) return null

  const label = RESOURCE_KIND_LABELS[firstMatch.kind] ?? 'resource'
  return `Choose a valid ${label} replacement.`
}
