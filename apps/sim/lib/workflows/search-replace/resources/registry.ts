import type { SubBlockType } from '@sim/workflow-types/blocks'
import { buildWorkflowSearchResourceGroupKey } from '@/lib/workflows/search-replace/resources/resolvers'
import type {
  WorkflowSearchMatch,
  WorkflowSearchMatchKind,
  WorkflowSearchResourceMeta,
} from '@/lib/workflows/search-replace/types'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'

export type StructuredWorkflowSearchResourceKind = Exclude<
  WorkflowSearchMatchKind,
  'text' | 'environment' | 'workflow-reference'
>

interface ResourceCodecParseParams {
  value: unknown
  kind: StructuredWorkflowSearchResourceKind
  subBlockConfig: Pick<SubBlockConfig, 'type' | 'serviceId' | 'selectorKey' | 'requiredScopes'>
  selectorContext?: SelectorContext
}

export interface StructuredResourceReference {
  kind: StructuredWorkflowSearchResourceKind
  rawValue: string
  searchText: string
  resource: WorkflowSearchResourceMeta
}

interface ResourceCodecReplaceResult {
  success: boolean
  nextValue?: unknown
  reason?: string
}

interface WorkflowSearchResourceCodec {
  parse(params: ResourceCodecParseParams): StructuredResourceReference[]
  contains(value: unknown, rawValue: string): boolean
  replace(
    value: unknown,
    rawValue: string,
    replacement: string,
    targetOccurrenceIndex?: number
  ): ResourceCodecReplaceResult
}

interface WorkflowSearchResourceKindDefinition {
  label: string
  constrained: boolean
  normalizeReplacement?: (replacement: string) => string
}

interface WorkflowSearchSubBlockResourceDefinition {
  kind: StructuredWorkflowSearchResourceKind
  codec: WorkflowSearchResourceCodec
}

function createResourceMeta({
  kind,
  rawValue,
  subBlockConfig,
  selectorContext,
}: {
  kind: StructuredWorkflowSearchResourceKind
  rawValue: string
  subBlockConfig: Pick<SubBlockConfig, 'serviceId' | 'selectorKey' | 'requiredScopes'>
  selectorContext?: SelectorContext
}): WorkflowSearchResourceMeta {
  const resource: WorkflowSearchResourceMeta = {
    kind,
    providerId: subBlockConfig.serviceId,
    serviceId: subBlockConfig.serviceId,
    selectorKey: subBlockConfig.selectorKey,
    selectorContext:
      selectorContext && Object.keys(selectorContext).length > 0 ? selectorContext : undefined,
    requiredScopes: subBlockConfig.requiredScopes,
    key: rawValue,
  }
  resource.resourceGroupKey = buildWorkflowSearchResourceGroupKey(resource)
  return resource
}

function splitCommaResourceValue(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => splitCommaResourceValue(item))
  }

  return []
}

function replaceCommaResourceValue(
  value: unknown,
  rawValue: string,
  replacement: string,
  targetOccurrenceIndex?: number
): ResourceCodecReplaceResult {
  let occurrenceIndex = 0
  let replaced = false

  const shouldReplace = (item: string) => {
    if (!item) return false
    const currentOccurrenceIndex = occurrenceIndex
    occurrenceIndex += 1
    if (item !== rawValue) return false
    const matchesTarget =
      targetOccurrenceIndex === undefined || currentOccurrenceIndex === targetOccurrenceIndex
    if (matchesTarget) replaced = true
    return matchesTarget
  }

  const replaceItem = (item: unknown): unknown => {
    if (typeof item === 'string') return shouldReplace(item) ? replacement : item
    if (Array.isArray(item)) return item.map(replaceItem)
    return item
  }

  if (typeof value === 'string') {
    const parts = value.split(',').map((part) => part.trim())
    if (parts.length > 1) {
      const nextValue = parts.map(replaceItem).join(',')
      if (targetOccurrenceIndex !== undefined && !replaced) {
        return { success: false, reason: 'Target resource changed since search' }
      }
      return { success: true, nextValue }
    }
    const nextValue = shouldReplace(value) ? replacement : value
    if (targetOccurrenceIndex !== undefined && !replaced) {
      return { success: false, reason: 'Target resource changed since search' }
    }
    return { success: true, nextValue }
  }

  if (Array.isArray(value)) {
    const nextValue = value.map(replaceItem)
    if (targetOccurrenceIndex !== undefined && !replaced) {
      return { success: false, reason: 'Target resource changed since search' }
    }
    return { success: true, nextValue }
  }

  return { success: false, reason: 'Target resource is no longer replaceable' }
}

function getFileResourceKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const key = record.key ?? record.path ?? record.name
  return typeof key === 'string' && key.trim().length > 0 ? key : null
}

function parseSerializedResourceValue(value: unknown): { value: unknown; serialized: boolean } {
  if (typeof value !== 'string') return { value, serialized: false }

  const trimmed = value.trim()
  if (
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return { value, serialized: false }
  }

  try {
    return { value: JSON.parse(trimmed), serialized: true }
  } catch {
    return { value, serialized: false }
  }
}

function parseFileReplacement(replacement: string): ResourceCodecReplaceResult {
  try {
    const parsed: unknown = JSON.parse(replacement)
    if (!getFileResourceKey(parsed)) {
      return { success: false, reason: 'Replacement file is no longer valid' }
    }
    return { success: true, nextValue: parsed }
  } catch {
    return { success: false, reason: 'Replacement file is no longer valid' }
  }
}

const scalarResourceCodec: WorkflowSearchResourceCodec = {
  parse({ value, kind, subBlockConfig, selectorContext }) {
    return splitCommaResourceValue(value).map((rawValue) => ({
      kind,
      rawValue,
      searchText: rawValue,
      resource: createResourceMeta({ kind, rawValue, subBlockConfig, selectorContext }),
    }))
  },
  contains(value, rawValue) {
    return splitCommaResourceValue(value).includes(rawValue)
  },
  replace: replaceCommaResourceValue,
}

const fileUploadResourceCodec: WorkflowSearchResourceCodec = {
  parse({ value, kind, subBlockConfig, selectorContext }) {
    const parsed = parseSerializedResourceValue(value).value
    const values = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    return values.flatMap((item) => {
      const rawValue = getFileResourceKey(item)
      if (!rawValue) return []
      const name = (item as Record<string, unknown>).name
      return [
        {
          kind,
          rawValue,
          searchText: typeof name === 'string' ? name : rawValue,
          resource: createResourceMeta({ kind, rawValue, subBlockConfig, selectorContext }),
        },
      ]
    })
  },
  contains(value, rawValue) {
    const parsed = parseSerializedResourceValue(value).value
    if (Array.isArray(parsed))
      return parsed.some((item) => fileUploadResourceCodec.contains(item, rawValue))
    return getFileResourceKey(parsed) === rawValue
  },
  replace(value, rawValue, replacement, targetOccurrenceIndex) {
    const parsed = parseSerializedResourceValue(value)
    let occurrenceIndex = 0
    let replaced = false

    const shouldReplace = (item: unknown) => {
      const itemKey = getFileResourceKey(item)
      if (!itemKey) return false
      const currentOccurrenceIndex = occurrenceIndex
      occurrenceIndex += 1
      if (itemKey !== rawValue) return false
      const matchesTarget =
        targetOccurrenceIndex === undefined || currentOccurrenceIndex === targetOccurrenceIndex
      if (matchesTarget) replaced = true
      return matchesTarget
    }

    const replaceItem = (item: unknown): ResourceCodecReplaceResult => {
      if (!shouldReplace(item)) return { success: true, nextValue: item }
      return parseFileReplacement(replacement)
    }

    if (Array.isArray(parsed.value)) {
      const nextValue: unknown[] = []
      for (const item of parsed.value) {
        const result = replaceItem(item)
        if (!result.success) return result
        nextValue.push(result.nextValue)
      }
      if (targetOccurrenceIndex !== undefined && !replaced) {
        return { success: false, reason: 'Target resource changed since search' }
      }
      return { success: true, nextValue: parsed.serialized ? JSON.stringify(nextValue) : nextValue }
    }

    const result = replaceItem(parsed.value)
    if (!result.success) return result
    if (targetOccurrenceIndex !== undefined && !replaced) {
      return { success: false, reason: 'Target resource changed since search' }
    }
    if (!parsed.serialized) return result
    return { success: true, nextValue: JSON.stringify(result.nextValue) }
  },
}

const WORKFLOW_SEARCH_RESOURCE_KINDS: Record<
  Exclude<WorkflowSearchMatchKind, 'text'>,
  WorkflowSearchResourceKindDefinition
> = {
  environment: {
    label: 'environment variable',
    constrained: true,
    normalizeReplacement: (replacement) => {
      const trimmed = replacement.trim()
      if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return trimmed
      return `{{${trimmed}}}`
    },
  },
  'workflow-reference': {
    label: 'workflow reference',
    constrained: false,
  },
  'oauth-credential': {
    label: 'OAuth credential',
    constrained: true,
  },
  'knowledge-base': {
    label: 'knowledge base',
    constrained: true,
  },
  'knowledge-document': {
    label: 'knowledge document',
    constrained: true,
  },
  workflow: {
    label: 'workflow',
    constrained: true,
  },
  'mcp-server': {
    label: 'MCP server',
    constrained: true,
  },
  'mcp-tool': {
    label: 'MCP tool',
    constrained: true,
  },
  table: {
    label: 'table',
    constrained: true,
  },
  file: {
    label: 'file',
    constrained: true,
  },
  'selector-resource': {
    label: 'selector resource',
    constrained: true,
  },
}

const WORKFLOW_SEARCH_SUBBLOCK_RESOURCES: Partial<
  Record<SubBlockType, WorkflowSearchSubBlockResourceDefinition>
> = {
  'oauth-input': { kind: 'oauth-credential', codec: scalarResourceCodec },
  'knowledge-base-selector': { kind: 'knowledge-base', codec: scalarResourceCodec },
  'document-selector': { kind: 'knowledge-document', codec: scalarResourceCodec },
  'workflow-selector': { kind: 'workflow', codec: scalarResourceCodec },
  'mcp-server-selector': { kind: 'mcp-server', codec: scalarResourceCodec },
  'mcp-tool-selector': { kind: 'mcp-tool', codec: scalarResourceCodec },
  'table-selector': { kind: 'table', codec: scalarResourceCodec },
  'file-selector': { kind: 'file', codec: scalarResourceCodec },
  'file-upload': { kind: 'file', codec: fileUploadResourceCodec },
  'channel-selector': { kind: 'selector-resource', codec: scalarResourceCodec },
  'user-selector': { kind: 'selector-resource', codec: scalarResourceCodec },
  'sheet-selector': { kind: 'selector-resource', codec: scalarResourceCodec },
  'folder-selector': { kind: 'selector-resource', codec: scalarResourceCodec },
  'project-selector': { kind: 'selector-resource', codec: scalarResourceCodec },
}

export function getWorkflowSearchResourceKindDefinition(
  kind: WorkflowSearchMatchKind
): WorkflowSearchResourceKindDefinition | null {
  return kind === 'text' ? null : WORKFLOW_SEARCH_RESOURCE_KINDS[kind]
}

export function isConstrainedWorkflowSearchResourceKind(kind: WorkflowSearchMatchKind): boolean {
  return getWorkflowSearchResourceKindDefinition(kind)?.constrained ?? false
}

export function getWorkflowSearchResourceKindLabel(kind: WorkflowSearchMatchKind): string {
  return getWorkflowSearchResourceKindDefinition(kind)?.label ?? 'resource'
}

export function normalizeWorkflowSearchResourceReplacement(
  match: WorkflowSearchMatch,
  replacement: string
): string {
  return (
    getWorkflowSearchResourceKindDefinition(match.kind)?.normalizeReplacement?.(replacement) ??
    replacement
  )
}

export function getWorkflowSearchSubBlockResourceDefinition(
  subBlockConfig?: Pick<SubBlockConfig, 'type'>
): WorkflowSearchSubBlockResourceDefinition | null {
  if (!subBlockConfig) return null
  return WORKFLOW_SEARCH_SUBBLOCK_RESOURCES[subBlockConfig.type] ?? null
}

export function getWorkflowSearchSubBlockResourceKind(
  subBlockConfig?: Pick<SubBlockConfig, 'type'>
): StructuredWorkflowSearchResourceKind | null {
  return getWorkflowSearchSubBlockResourceDefinition(subBlockConfig)?.kind ?? null
}

export function parseWorkflowSearchSubBlockResources(
  value: unknown,
  subBlockConfig?: Pick<SubBlockConfig, 'type' | 'serviceId' | 'selectorKey' | 'requiredScopes'>,
  selectorContext?: SelectorContext
): StructuredResourceReference[] {
  const definition = getWorkflowSearchSubBlockResourceDefinition(subBlockConfig)
  if (!definition || !subBlockConfig) return []
  return definition.codec.parse({
    value,
    kind: definition.kind,
    subBlockConfig,
    selectorContext,
  })
}

export function workflowSearchResourceValueContains(
  match: WorkflowSearchMatch,
  value: unknown
): boolean {
  return (
    getWorkflowSearchSubBlockResourceDefinition({ type: match.subBlockType })?.codec.contains(
      value,
      match.rawValue
    ) ?? false
  )
}

export function replaceWorkflowSearchResourceValue(
  match: WorkflowSearchMatch,
  value: unknown,
  replacement: string
): ResourceCodecReplaceResult {
  const codec = getWorkflowSearchSubBlockResourceDefinition({ type: match.subBlockType })?.codec
  if (!codec) return { success: false, reason: 'Target resource is no longer replaceable' }
  return codec.replace(value, match.rawValue, replacement, match.structuredOccurrenceIndex)
}
