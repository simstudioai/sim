import type { SubBlockType } from '@sim/workflow-types/blocks'
import { buildWorkflowSearchResourceGroupKey } from '@/lib/workflows/search-replace/resource-resolvers'
import type {
  WorkflowSearchMatchKind,
  WorkflowSearchRange,
  WorkflowSearchResourceMeta,
} from '@/lib/workflows/search-replace/types'
import type { SubBlockConfig } from '@/blocks/types'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import type { SelectorContext } from '@/hooks/selectors/types'

export interface ParsedInlineReference {
  kind: 'environment' | 'workflow-reference'
  rawValue: string
  searchText: string
  range: WorkflowSearchRange
  resource: WorkflowSearchResourceMeta
}

export interface StructuredResourceReference {
  kind: Exclude<WorkflowSearchMatchKind, 'text' | 'environment' | 'workflow-reference'>
  rawValue: string
  searchText: string
  resource: WorkflowSearchResourceMeta
}

const RESOURCE_KIND_BY_SUBBLOCK_TYPE: Partial<
  Record<
    SubBlockType,
    Exclude<WorkflowSearchMatchKind, 'text' | 'environment' | 'workflow-reference'>
  >
> = {
  'oauth-input': 'oauth-credential',
  'knowledge-base-selector': 'knowledge-base',
  'document-selector': 'knowledge-document',
  'workflow-selector': 'workflow',
  'mcp-server-selector': 'mcp-server',
  'mcp-tool-selector': 'mcp-tool',
  'table-selector': 'table',
  'file-selector': 'file',
  'channel-selector': 'selector-resource',
  'user-selector': 'selector-resource',
  'sheet-selector': 'selector-resource',
  'folder-selector': 'selector-resource',
  'project-selector': 'selector-resource',
  'variables-input': 'selector-resource',
}

export function getResourceKindForSubBlock(
  subBlockConfig?: Pick<SubBlockConfig, 'type'>
): StructuredResourceReference['kind'] | null {
  if (!subBlockConfig) return null
  return RESOURCE_KIND_BY_SUBBLOCK_TYPE[subBlockConfig.type] ?? null
}

export function parseInlineReferences(value: string): ParsedInlineReference[] {
  const references: ParsedInlineReference[] = []

  const envPattern = createEnvVarPattern()
  for (const match of value.matchAll(envPattern)) {
    const rawValue = match[0]
    const key = String(match[1] ?? '').trim()
    const start = match.index ?? 0
    references.push({
      kind: 'environment',
      rawValue,
      searchText: key,
      range: { start, end: start + rawValue.length },
      resource: {
        kind: 'environment',
        token: rawValue,
        key,
      },
    })
  }

  const referencePattern = createReferencePattern()
  for (const match of value.matchAll(referencePattern)) {
    const rawValue = match[0]
    const reference = String(match[1] ?? '').trim()
    const start = match.index ?? 0
    references.push({
      kind: 'workflow-reference',
      rawValue,
      searchText: reference,
      range: { start, end: start + rawValue.length },
      resource: {
        kind: 'workflow-reference',
        token: rawValue,
        key: reference,
      },
    })
  }

  return references.sort((a, b) => a.range.start - b.range.start)
}

function splitStructuredValue(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => splitStructuredValue(item))
  }

  return []
}

export function parseStructuredResourceReferences(
  value: unknown,
  subBlockConfig?: SubBlockConfig,
  selectorContext?: SelectorContext
): StructuredResourceReference[] {
  const kind = getResourceKindForSubBlock(subBlockConfig)
  if (!kind) return []

  const values = splitStructuredValue(value)
  return values.map((rawValue) => {
    const resource: WorkflowSearchResourceMeta = {
      kind,
      providerId: subBlockConfig?.serviceId,
      serviceId: subBlockConfig?.serviceId,
      selectorKey: subBlockConfig?.selectorKey,
      selectorContext: subBlockConfig?.selectorKey ? selectorContext : undefined,
      requiredScopes: subBlockConfig?.requiredScopes,
      key: rawValue,
    }
    resource.resourceGroupKey = buildWorkflowSearchResourceGroupKey(resource)

    return {
      kind,
      rawValue,
      searchText: rawValue,
      resource,
    }
  })
}

export function matchesSearchText(
  candidate: string,
  query: string | undefined,
  caseSensitive = false
): boolean {
  if (!query) return true
  const source = caseSensitive ? candidate : candidate.toLowerCase()
  const target = caseSensitive ? query : query.toLowerCase()
  return source.includes(target)
}
