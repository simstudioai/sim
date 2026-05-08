import { DEFAULT_SUBBLOCK_TYPE } from '@sim/workflow-persistence/subblocks'
import type { SubBlockType } from '@sim/workflow-types/blocks'
import { isWorkflowBlockProtected } from '@sim/workflow-types/workflow'
import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import {
  getSearchableJsonStringLeaves,
  isSearchableJsonValueSubBlock,
  shouldParseSerializedSubBlockValue,
} from '@/lib/workflows/search-replace/json-value-fields'
import {
  getResourceKindForSubBlock,
  matchesSearchText,
  parseInlineReferences,
  parseStructuredResourceReferences,
} from '@/lib/workflows/search-replace/resources'
import { getWorkflowSearchSubflowFields } from '@/lib/workflows/search-replace/subflow-fields'
import type {
  WorkflowSearchBlockState,
  WorkflowSearchIndexerOptions,
  WorkflowSearchMatch,
  WorkflowSearchValuePath,
} from '@/lib/workflows/search-replace/types'
import { pathToKey, walkStringValues } from '@/lib/workflows/search-replace/value-walker'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isSubBlockFeatureEnabled,
  isSubBlockHidden,
  isSubBlockVisibleForMode,
  isSubBlockVisibleForTriggerMode,
  normalizeDependencyValue,
  parseDependsOn,
  resolveDependencyValue,
  shouldUseSubBlockForTriggerModeCanonicalIndex,
} from '@/lib/workflows/subblocks/visibility'
import { isSyntheticToolSubBlockId } from '@/lib/workflows/tool-input/synthetic-subblocks'
import { type ParsedStoredTool, parseStoredToolInputValue } from '@/lib/workflows/tool-input/types'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { isReference } from '@/executor/constants'
import type { SelectorContext } from '@/hooks/selectors/types'
import {
  getSubBlocksForToolInput,
  getToolIdForOperation,
  getToolParametersConfig,
  type ToolParameterConfig,
} from '@/tools/params'

function normalizeForSearch(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase()
}

function findTextRanges(value: string, query: string, caseSensitive: boolean) {
  if (!query) return []
  const source = normalizeForSearch(value, caseSensitive)
  const target = normalizeForSearch(query, caseSensitive)
  const ranges: Array<{ start: number; end: number }> = []

  let index = source.indexOf(target)
  while (index !== -1) {
    ranges.push({ start: index, end: index + target.length })
    index = source.indexOf(target, index + Math.max(target.length, 1))
  }

  return ranges
}

function createMatchId(parts: Array<string | number | undefined>): string {
  return parts
    .filter((part) => part !== undefined && part !== '')
    .map((part) => String(part).replaceAll(':', '_'))
    .join(':')
}

const STRUCTURED_METADATA_LEAF_KEYS = new Set(['id', 'collapsed'])

const INPUT_FORMAT_FIELD_TITLES: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  value: 'Value',
}

const EVAL_INPUT_FIELD_TITLES: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  min: 'Min Value',
  max: 'Max Value',
}

const PLAIN_TEXT_EXCLUDED_SUBBLOCK_TYPES = new Set<SubBlockType>([
  'dropdown',
  'checkbox-list',
  'grouped-checkbox-list',
  'skill-input',
  'sort-builder',
  'time-input',
  'file-upload',
  'mcp-dynamic-args',
  'modal',
  'schedule-info',
  'slider',
  'switch',
  'text',
  'webhook-config',
])

const DISPLAY_ONLY_SUBBLOCK_TYPES = new Set<SubBlockType>([
  'modal',
  'schedule-info',
  'text',
  'webhook-config',
])

const TEXT_VALUE_ONLY_SUBBLOCK_TYPES = new Set<SubBlockType>(['filter-builder', 'variables-input'])

const TOOL_INPUT_TEXT_EXCLUDED_LEAF_KEYS = new Set([
  'type',
  'toolId',
  'customToolId',
  'operation',
  'usageControl',
  'serverId',
  'toolName',
  'credentialId',
  'oauthCredential',
  'workflowId',
])

const TOOL_INPUT_TEXT_EXCLUDED_PATH_KEYS = new Set(['schema'])

type WorkflowSearchSubBlockConfig = Pick<SubBlockConfig, 'id' | 'type'> & Partial<SubBlockConfig>

function looksLikeStoredSkillList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).skillId === 'string'
    )
  )
}

function looksLikeStructuredString(value: string): boolean {
  const trimmed = value.trim()
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )
}

function getFallbackToolParamType(value: unknown, paramType?: string): SubBlockType {
  if (paramType === 'object') return 'workflow-input-mapper'
  if (value && typeof value === 'object' && !Array.isArray(value)) return 'workflow-input-mapper'
  if (typeof value !== 'string') return DEFAULT_SUBBLOCK_TYPE as SubBlockType

  const trimmed = value.trim()
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    return DEFAULT_SUBBLOCK_TYPE as SubBlockType
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return 'workflow-input-mapper'
    }
  } catch {}

  return DEFAULT_SUBBLOCK_TYPE as SubBlockType
}

function isSearchableLeafPath(
  path: Array<string | number>,
  subBlockType: SubBlockType | undefined,
  mode: 'text' | 'reference'
): boolean {
  if (mode === 'text' && subBlockType && PLAIN_TEXT_EXCLUDED_SUBBLOCK_TYPES.has(subBlockType)) {
    return false
  }
  const lastSegment = path.at(-1)
  if (typeof lastSegment !== 'string') return true
  if (mode === 'text' && subBlockType === 'messages-input' && lastSegment === 'role') {
    return false
  }
  if (mode === 'text' && subBlockType === 'tool-input') {
    if (TOOL_INPUT_TEXT_EXCLUDED_LEAF_KEYS.has(lastSegment)) return false
    if (lastSegment.endsWith('Id')) return false
    if (
      path.some(
        (segment) => typeof segment === 'string' && TOOL_INPUT_TEXT_EXCLUDED_PATH_KEYS.has(segment)
      )
    ) {
      return false
    }
  }
  if (mode === 'text' && subBlockType && TEXT_VALUE_ONLY_SUBBLOCK_TYPES.has(subBlockType)) {
    return lastSegment === 'value'
  }
  if (
    mode === 'text' &&
    (subBlockType === 'input-format' ||
      subBlockType === 'response-format' ||
      subBlockType === 'eval-input') &&
    lastSegment === 'type'
  ) {
    return false
  }
  return !STRUCTURED_METADATA_LEAF_KEYS.has(lastSegment)
}

function getSearchableStringLeaves(
  value: unknown,
  subBlockType: SubBlockType | undefined,
  mode: 'text' | 'reference'
) {
  return walkStringValues(value).filter((leaf) =>
    isSearchableLeafPath(leaf.path, subBlockType, mode)
  )
}

function getStructuredFieldTitle(
  subBlockType: SubBlockType | undefined,
  path: WorkflowSearchValuePath
) {
  const lastSegment = path.at(-1)
  if (typeof lastSegment !== 'string') return undefined

  if (subBlockType === 'input-format' || subBlockType === 'response-format') {
    return INPUT_FORMAT_FIELD_TITLES[lastSegment]
  }

  if (subBlockType === 'eval-input') {
    return EVAL_INPUT_FIELD_TITLES[lastSegment]
  }

  return undefined
}

function getTextLeaves(value: unknown, subBlockType: SubBlockType | undefined) {
  if (isSearchableJsonValueSubBlock(subBlockType)) {
    return getSearchableJsonStringLeaves(value, subBlockType)
  }
  if (looksLikeStoredSkillList(value)) return []
  return getSearchableStringLeaves(value, subBlockType, 'text')
    .filter(
      (leaf) =>
        subBlockType !== 'tool-input' ||
        typeof leaf.value !== 'string' ||
        !looksLikeStructuredString(leaf.value)
    )
    .map((leaf) => ({
      ...leaf,
      fieldTitle: getStructuredFieldTitle(subBlockType, leaf.path),
    }))
}

function scopeToolCanonicalModes(
  canonicalModes: CanonicalModeOverrides | undefined,
  blockType: string | undefined
): CanonicalModeOverrides | undefined {
  if (!canonicalModes || !blockType) return undefined

  const prefix = `${blockType}:`
  let scoped: CanonicalModeOverrides | undefined
  for (const [key, value] of Object.entries(canonicalModes)) {
    if (!key.startsWith(prefix) || !value) continue
    scoped = scoped ?? {}
    scoped[key.slice(prefix.length)] = value
  }
  return scoped
}

function parseToolParamValue(value: unknown, subBlockType: SubBlockType): unknown {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return value
  if (!shouldParseSerializedSubBlockValue(subBlockType)) {
    return value
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : value
  } catch {
    return value
  }
}

function isToolParamVisibleForReactiveCondition({
  subBlockConfig,
  values,
  canonicalIndex,
  canonicalModes,
  credentialTypeById,
}: {
  subBlockConfig: WorkflowSearchSubBlockConfig
  values: Record<string, unknown>
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>
  canonicalModes?: CanonicalModeOverrides
  credentialTypeById?: Record<string, string | undefined>
}) {
  if (!subBlockConfig.reactiveCondition) return true
  return isReactiveSearchSubBlockVisible({
    subBlockConfig,
    subBlockValues: values,
    canonicalIndex,
    canonicalModes,
    credentialTypeById,
  })
}

interface AddTextMatchesOptions {
  matches: WorkflowSearchMatch[]
  idPrefix: string
  block: WorkflowSearchBlockState
  subBlockId: string
  canonicalSubBlockId: string
  subBlockType: SubBlockType
  fieldTitle?: string
  value: string
  valuePath: WorkflowSearchValuePath
  target: WorkflowSearchMatch['target']
  query?: string
  caseSensitive: boolean
  editable: boolean
  protectedByLock: boolean
  isSnapshotView: boolean
  readonlyReason?: string
}

function getReadonlyReason({
  editable,
  isSnapshotView,
  readonlyReason,
}: {
  editable: boolean
  isSnapshotView: boolean
  readonlyReason?: string
}) {
  if (editable) return undefined
  return readonlyReason ?? (isSnapshotView ? 'Snapshot view is readonly' : 'Block is locked')
}

function addTextMatches({
  matches,
  idPrefix,
  block,
  subBlockId,
  canonicalSubBlockId,
  subBlockType,
  fieldTitle,
  value,
  valuePath,
  target,
  query,
  caseSensitive,
  editable,
  protectedByLock,
  isSnapshotView,
  readonlyReason,
}: AddTextMatchesOptions) {
  const ranges = query ? findTextRanges(value, query, caseSensitive) : []
  ranges.forEach((range, occurrenceIndex) => {
    matches.push({
      id: createMatchId([
        idPrefix,
        block.id,
        subBlockId,
        pathToKey(valuePath),
        range.start,
        occurrenceIndex,
      ]),
      blockId: block.id,
      blockName: block.name,
      blockType: block.type,
      subBlockId,
      canonicalSubBlockId,
      subBlockType,
      fieldTitle,
      valuePath,
      target,
      kind: 'text',
      rawValue: value.slice(range.start, range.end),
      searchText: value,
      range,
      editable,
      navigable: true,
      protected: protectedByLock,
      reason: getReadonlyReason({ editable, isSnapshotView, readonlyReason }),
    })
  })
}

function buildToolInputSearchConfig(param: ToolParameterConfig): WorkflowSearchSubBlockConfig {
  const uiComponent = param.uiComponent
  return {
    id: param.id,
    title: uiComponent?.title ?? param.id,
    type: (uiComponent?.type ?? getFallbackToolParamType(undefined, param.type)) as SubBlockType,
    placeholder: uiComponent?.placeholder,
    condition: uiComponent?.condition as SubBlockConfig['condition'],
    serviceId: uiComponent?.serviceId,
    selectorKey: uiComponent?.selectorKey,
    requiredScopes: uiComponent?.requiredScopes,
    mimeType: uiComponent?.mimeType,
    canonicalParamId: uiComponent?.canonicalParamId,
    mode: uiComponent?.mode,
    password: uiComponent?.password,
    dependsOn: uiComponent?.dependsOn,
  }
}

function isVisibleToolParameter(param: ToolParameterConfig, values: Record<string, unknown>) {
  if (param.visibility === 'hidden' || param.visibility === 'llm-only') return false
  const condition = param.uiComponent?.condition
  return (
    !condition ||
    evaluateSubBlockCondition(condition as Parameters<typeof evaluateSubBlockCondition>[0], values)
  )
}

function getToolInputParamConfigs({
  tool,
  parentCanonicalModes,
  credentialTypeById,
  blockConfigs,
}: {
  tool: ParsedStoredTool
  parentCanonicalModes?: CanonicalModeOverrides
  credentialTypeById?: Record<string, string | undefined>
  blockConfigs?: WorkflowSearchIndexerOptions['blockConfigs']
}): Array<{
  paramId: string
  config: WorkflowSearchSubBlockConfig
  value: unknown
  selectorContext?: SelectorContext
  dependentValuePaths?: WorkflowSearchValuePath[]
}> {
  const toolId =
    tool.type !== 'custom-tool' && tool.type !== 'mcp'
      ? getToolIdForOperation(tool.type, tool.operation) || tool.toolId
      : tool.toolId
  const toolParamValues = tool.params ?? {}
  const values = { operation: tool.operation, ...toolParamValues }
  const genericFallback = () =>
    Object.entries(toolParamValues)
      .filter(([paramId, value]) => {
        if (TOOL_INPUT_TEXT_EXCLUDED_LEAF_KEYS.has(paramId)) return false
        if (paramId.endsWith('Id')) return false
        return (
          typeof value !== 'string' ||
          !looksLikeStructuredString(value) ||
          value.trim().startsWith('{')
        )
      })
      .map(([paramId, value]) => {
        const type = getFallbackToolParamType(value)
        return {
          paramId,
          config: {
            id: paramId,
            title: paramId,
            type,
            condition: undefined,
          },
          value: parseToolParamValue(value, type),
        }
      })

  if (!toolId) return genericFallback()

  const scopedCanonicalModes = scopeToolCanonicalModes(parentCanonicalModes, tool.type)
  const blockConfig =
    tool.type !== 'custom-tool' && tool.type !== 'mcp'
      ? (blockConfigs?.[tool.type] ?? getBlock(tool.type))
      : null
  const subBlocksResult =
    tool.type !== 'custom-tool' && tool.type !== 'mcp'
      ? getSubBlocksForToolInput(
          toolId,
          tool.type,
          values,
          scopedCanonicalModes,
          blockConfig?.subBlocks ? { subBlocks: blockConfig.subBlocks } : undefined
        )
      : null
  const toolParams = getToolParametersConfig(toolId, tool.type, values)
  const displayParams = toolParams?.userInputParameters ?? []

  if (!toolParams && !subBlocksResult) return genericFallback()

  if (!subBlocksResult?.subBlocks.length) {
    const fallbackCanonicalIndex = buildCanonicalIndex([])
    return displayParams
      .filter((param) => isVisibleToolParameter(param, values))
      .map((param) => {
        const config = buildToolInputSearchConfig(param)
        return {
          paramId: param.id,
          config,
          value: parseToolParamValue(toolParamValues[param.id], config.type),
          selectorContext:
            config.selectorKey || config.dependsOn
              ? buildSelectorContext({
                  subBlockConfig: config,
                  subBlockValues: values,
                  canonicalIndex: fallbackCanonicalIndex,
                  canonicalModes: scopedCanonicalModes,
                })
              : undefined,
        }
      })
  }

  const toolCanonicalIndex = buildCanonicalIndex(
    blockConfig?.subBlocks ?? subBlocksResult.subBlocks
  )
  const visibleSubBlocks = subBlocksResult.subBlocks.filter((subBlock) =>
    isToolParamVisibleForReactiveCondition({
      subBlockConfig: subBlock,
      values,
      canonicalIndex: toolCanonicalIndex,
      canonicalModes: scopedCanonicalModes,
      credentialTypeById,
    })
  )
  const allToolSubBlocks = blockConfig?.subBlocks ?? subBlocksResult.subBlocks
  const getDependentValuePaths = (changedSubBlockId: string): WorkflowSearchValuePath[] =>
    getWorkflowSearchDependentClears(allToolSubBlocks, changedSubBlockId).map((clear) => [
      'params',
      clear.subBlockId,
    ])

  const coveredParamIds = new Set(
    visibleSubBlocks.flatMap((subBlock) => {
      const ids = [subBlock.id]
      if (subBlock.canonicalParamId) ids.push(subBlock.canonicalParamId)
      const canonicalId = toolCanonicalIndex.canonicalIdBySubBlockId[subBlock.id]
      if (canonicalId) {
        const group = toolCanonicalIndex.groupsById[canonicalId]
        if (group) {
          if (group.basicId) ids.push(group.basicId)
          ids.push(...group.advancedIds)
        }
      }
      return ids
    })
  )

  const subBlockParams = visibleSubBlocks.map((config) => ({
    paramId: config.id,
    config,
    value: parseToolParamValue(toolParamValues[config.id], config.type),
    dependentValuePaths: getDependentValuePaths(config.id),
    selectorContext:
      config.selectorKey || config.dependsOn
        ? buildSelectorContext({
            subBlockConfig: config,
            subBlockValues: values,
            canonicalIndex: toolCanonicalIndex,
            canonicalModes: scopedCanonicalModes,
          })
        : undefined,
  }))
  const uncoveredParams = displayParams
    .filter((param) => !coveredParamIds.has(param.id) && isVisibleToolParameter(param, values))
    .map((param) => {
      const config = buildToolInputSearchConfig(param)
      return {
        paramId: param.id,
        config,
        value: parseToolParamValue(toolParamValues[param.id], config.type),
        selectorContext:
          config.selectorKey || config.dependsOn
            ? buildSelectorContext({
                subBlockConfig: config,
                subBlockValues: values,
                canonicalIndex: toolCanonicalIndex,
                canonicalModes: scopedCanonicalModes,
              })
            : undefined,
      }
    })

  return [...subBlockParams, ...uncoveredParams]
}

function buildSelectorContext({
  subBlockConfig,
  subBlockValues,
  canonicalIndex,
  canonicalModes,
  workspaceId,
  workflowId,
}: {
  subBlockConfig?: WorkflowSearchSubBlockConfig
  subBlockValues: Record<string, unknown>
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>
  canonicalModes?: CanonicalModeOverrides
  workspaceId?: string
  workflowId?: string
}): SelectorContext {
  const context: SelectorContext = {}
  if (workspaceId) context.workspaceId = workspaceId
  if (workflowId) {
    context.workflowId = workflowId
    context.excludeWorkflowId = workflowId
  }

  if (subBlockConfig?.mimeType) context.mimeType = subBlockConfig.mimeType

  const { allDependsOnFields } = parseDependsOn(subBlockConfig?.dependsOn)

  for (const subBlockId of allDependsOnFields) {
    const value = normalizeDependencyValue(
      resolveDependencyValue(subBlockId, subBlockValues, canonicalIndex, canonicalModes)
    )
    if (value === null || value === undefined) continue
    const stringValue = typeof value === 'string' ? value : String(value)
    if (!stringValue) continue
    if (isReference(stringValue)) continue

    const canonicalKey = canonicalIndex.canonicalIdBySubBlockId[subBlockId] ?? subBlockId
    if (subBlockConfig?.type === 'mcp-tool-selector' && canonicalKey === 'server') {
      context.mcpServerId = stringValue
      continue
    }
    if (SELECTOR_CONTEXT_FIELDS.has(canonicalKey as keyof SelectorContext)) {
      context[canonicalKey as keyof SelectorContext] = stringValue
    }
  }

  return context
}

function buildSearchSelectorContext({
  block,
  subBlockConfig,
  subBlockValues,
  canonicalIndex,
  workspaceId,
  workflowId,
}: {
  block: WorkflowSearchBlockState
  subBlockConfig?: WorkflowSearchSubBlockConfig
  subBlockValues: Record<string, unknown>
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>
  workspaceId?: string
  workflowId?: string
}): SelectorContext {
  return buildSelectorContext({
    subBlockConfig,
    subBlockValues,
    canonicalIndex,
    canonicalModes: getSearchCanonicalModes(block),
    workspaceId,
    workflowId,
  })
}

function addToolInputMatches({
  matches,
  block,
  subBlockId,
  canonicalSubBlockId,
  value,
  mode,
  query,
  caseSensitive,
  includeResourceMatchesWithoutQuery,
  resourceQueryEnabled,
  editable,
  protectedByLock,
  isSnapshotView,
  readonlyReason,
  workspaceId,
  workflowId,
  credentialTypeById,
  blockConfigs,
}: {
  matches: WorkflowSearchMatch[]
  block: WorkflowSearchBlockState
  subBlockId: string
  canonicalSubBlockId: string
  value: unknown
  mode: WorkflowSearchIndexerOptions['mode']
  query?: string
  caseSensitive: boolean
  includeResourceMatchesWithoutQuery: boolean
  resourceQueryEnabled: boolean
  editable: boolean
  protectedByLock: boolean
  isSnapshotView: boolean
  readonlyReason?: string
  workspaceId?: string
  workflowId?: string
  credentialTypeById?: Record<string, string | undefined>
  blockConfigs?: WorkflowSearchIndexerOptions['blockConfigs']
}) {
  const parentCanonicalModes = getSearchCanonicalModes(block)

  parseStoredToolInputValue(value).forEach((tool, toolIndex) => {
    if (mode !== 'resource' && tool.title) {
      addTextMatches({
        matches,
        idPrefix: 'tool-input-title',
        block,
        subBlockId,
        canonicalSubBlockId,
        subBlockType: 'tool-input',
        fieldTitle: 'Tool',
        value: tool.title,
        valuePath: [toolIndex, 'title'],
        target: { kind: 'subblock' },
        query,
        caseSensitive,
        editable,
        protectedByLock,
        isSnapshotView,
        readonlyReason,
      })
    }

    const params = getToolInputParamConfigs({
      tool,
      parentCanonicalModes,
      credentialTypeById,
      blockConfigs,
    })

    for (const {
      paramId,
      config,
      value: paramValue,
      selectorContext,
      dependentValuePaths,
    } of params) {
      const subBlockType = config.type
      const structuredResourceKind = getResourceKindForSubBlock(config)
      const basePath: WorkflowSearchValuePath = [toolIndex, 'params', paramId]
      const nestedDependentValuePaths = dependentValuePaths?.map((path) => [toolIndex, ...path])

      if (mode !== 'resource' && !structuredResourceKind) {
        for (const leaf of getTextLeaves(paramValue, subBlockType)) {
          const leafEditable = editable && typeof leaf.originalValue === 'string'
          addTextMatches({
            matches,
            idPrefix: 'tool-input-text',
            block,
            subBlockId,
            canonicalSubBlockId,
            subBlockType,
            fieldTitle: config.title,
            value: leaf.value,
            valuePath: [...basePath, ...leaf.path],
            target: { kind: 'subblock' },
            query,
            caseSensitive,
            editable: leafEditable,
            protectedByLock,
            isSnapshotView,
            readonlyReason: leafEditable
              ? undefined
              : typeof leaf.originalValue === 'string'
                ? readonlyReason
                : 'Only text values can be replaced',
          })
        }
      }

      if (mode === 'text' || !resourceQueryEnabled) continue

      for (const leaf of getSearchableStringLeaves(paramValue, subBlockType, 'reference')) {
        const inlineReferences = parseInlineReferences(leaf.value)
        inlineReferences.forEach((reference, referenceIndex) => {
          const searchable = `${reference.rawValue} ${reference.searchText}`
          if (
            !includeResourceMatchesWithoutQuery &&
            !matchesSearchText(searchable, query, caseSensitive)
          ) {
            return
          }

          matches.push({
            id: createMatchId([
              reference.kind,
              block.id,
              subBlockId,
              toolIndex,
              paramId,
              pathToKey(leaf.path),
              reference.range.start,
              referenceIndex,
            ]),
            blockId: block.id,
            blockName: block.name,
            blockType: block.type,
            subBlockId,
            canonicalSubBlockId,
            subBlockType,
            fieldTitle: config.title,
            valuePath: [...basePath, ...leaf.path],
            target: { kind: 'subblock' },
            kind: reference.kind,
            rawValue: reference.rawValue,
            searchText: reference.searchText,
            range: reference.range,
            dependentValuePaths: nestedDependentValuePaths,
            resource: reference.resource,
            editable,
            navigable: true,
            protected: protectedByLock,
            reason: getReadonlyReason({ editable, isSnapshotView, readonlyReason }),
          })
        })
      }

      const structuredReferences = parseStructuredResourceReferences(
        paramValue,
        config,
        selectorContext
          ? {
              ...selectorContext,
              ...(workspaceId && { workspaceId }),
              ...(workflowId && { workflowId, excludeWorkflowId: workflowId }),
            }
          : undefined
      )
      structuredReferences.forEach((reference, referenceIndex) => {
        const searchable = `${reference.rawValue} ${reference.searchText} ${reference.kind}`
        if (
          !includeResourceMatchesWithoutQuery &&
          !matchesSearchText(searchable, query, caseSensitive)
        ) {
          return
        }

        matches.push({
          id: createMatchId([
            reference.kind,
            block.id,
            subBlockId,
            toolIndex,
            paramId,
            reference.rawValue,
            referenceIndex,
          ]),
          blockId: block.id,
          blockName: block.name,
          blockType: block.type,
          subBlockId,
          canonicalSubBlockId,
          subBlockType,
          fieldTitle: config.title,
          valuePath: basePath,
          target: { kind: 'subblock' },
          kind: reference.kind,
          rawValue: reference.rawValue,
          searchText: reference.searchText,
          structuredOccurrenceIndex: referenceIndex,
          dependentValuePaths: nestedDependentValuePaths,
          resource: reference.resource,
          editable,
          navigable: true,
          protected: protectedByLock,
          reason: getReadonlyReason({ editable, isSnapshotView, readonlyReason }),
        })
      })
    }
  })
}

function getSearchCanonicalModes(
  block: WorkflowSearchBlockState
): CanonicalModeOverrides | undefined {
  const data = block.data
  if (!data || typeof data !== 'object') return undefined
  return (data as { canonicalModes?: CanonicalModeOverrides }).canonicalModes
}

function isReactiveSearchSubBlockVisible({
  subBlockConfig,
  subBlockValues,
  canonicalIndex,
  canonicalModes,
  credentialTypeById,
}: {
  subBlockConfig?: WorkflowSearchSubBlockConfig
  subBlockValues: Record<string, unknown>
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>
  canonicalModes?: CanonicalModeOverrides
  credentialTypeById?: Record<string, string | undefined>
}): boolean {
  const reactiveCondition = subBlockConfig?.reactiveCondition
  if (!reactiveCondition) return true

  const watchedCredentialId = reactiveCondition.watchFields
    .map((field) =>
      normalizeDependencyValue(
        resolveDependencyValue(field, subBlockValues, canonicalIndex, canonicalModes)
      )
    )
    .find((value): value is string => typeof value === 'string' && value.length > 0)

  if (!watchedCredentialId || isReference(watchedCredentialId)) return false
  return credentialTypeById?.[watchedCredentialId] === reactiveCondition.requiredType
}

function isSearchSubBlockVisibleForMode({
  block,
  blockConfig,
  subBlockConfig,
  subBlockValues,
  canonicalIndex,
  canonicalModes,
}: {
  block: WorkflowSearchBlockState
  blockConfig?: NonNullable<WorkflowSearchIndexerOptions['blockConfigs']>[string]
  subBlockConfig?: WorkflowSearchSubBlockConfig
  subBlockValues: Record<string, unknown>
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>
  canonicalModes?: CanonicalModeOverrides
}): boolean {
  if (!subBlockConfig) return true

  const displayTriggerMode = Boolean(block.triggerMode)
  if (
    !isSubBlockVisibleForTriggerMode(
      subBlockConfig as SubBlockConfig,
      displayTriggerMode,
      blockConfig
    )
  ) {
    return false
  }

  return isSubBlockVisibleForMode(
    subBlockConfig as SubBlockConfig,
    Boolean(block.advancedMode),
    canonicalIndex,
    subBlockValues,
    canonicalModes
  )
}

export function indexWorkflowSearchMatches(
  options: WorkflowSearchIndexerOptions
): WorkflowSearchMatch[] {
  const {
    workflow,
    query,
    mode = 'all',
    caseSensitive = false,
    includeResourceMatchesWithoutQuery = false,
    isSnapshotView = false,
    isReadOnly = isSnapshotView,
    readonlyReason,
    workspaceId,
    workflowId,
    blockConfigs = {},
    credentialTypeById,
  } = options

  const matches: WorkflowSearchMatch[] = []
  const resourceQueryEnabled = includeResourceMatchesWithoutQuery || Boolean(query)

  for (const block of Object.values(workflow.blocks)) {
    const blockConfig = blockConfigs[block.type] ?? getBlock(block.type)
    const subBlockConfigs = blockConfig?.subBlocks ?? []
    const canonicalSubBlockConfigs = block.triggerMode
      ? subBlockConfigs.filter(shouldUseSubBlockForTriggerModeCanonicalIndex)
      : subBlockConfigs
    const configsById = new Map(subBlockConfigs.map((subBlock) => [subBlock.id, subBlock]))
    const canonicalIndex = buildCanonicalIndex(canonicalSubBlockConfigs)
    const subBlockValues = buildSubBlockValues(block.subBlocks ?? {})
    const canonicalModes = getSearchCanonicalModes(block)
    const protectedByLock = isWorkflowBlockProtected(block.id, workflow.blocks)
    const editable = !protectedByLock && !isReadOnly

    if (mode !== 'resource') {
      for (const field of getWorkflowSearchSubflowFields(block)) {
        const fieldEditable = editable && field.editable
        addTextMatches({
          matches,
          idPrefix: 'subflow-text',
          block,
          subBlockId: field.id,
          canonicalSubBlockId: field.id,
          subBlockType: field.type,
          fieldTitle: field.title,
          value: field.value,
          valuePath: [],
          target: { kind: 'subflow', fieldId: field.id },
          query,
          caseSensitive,
          editable: fieldEditable,
          protectedByLock,
          isSnapshotView,
          readonlyReason: fieldEditable ? undefined : !editable ? readonlyReason : field.reason,
        })
      }
    }

    for (const [subBlockId, subBlockState] of Object.entries(block.subBlocks ?? {})) {
      if (isSyntheticToolSubBlockId(subBlockId)) continue
      const subBlockConfig = configsById.get(subBlockId)
      if (subBlockConfig?.hidden) continue
      if (subBlockConfig && !isSubBlockFeatureEnabled(subBlockConfig)) continue
      if (subBlockConfig && isSubBlockHidden(subBlockConfig)) continue
      if (
        !isSearchSubBlockVisibleForMode({
          block,
          blockConfig,
          subBlockConfig,
          subBlockValues,
          canonicalIndex,
          canonicalModes,
        })
      ) {
        continue
      }
      if (
        !isReactiveSearchSubBlockVisible({
          subBlockConfig,
          subBlockValues,
          canonicalIndex,
          canonicalModes,
          credentialTypeById,
        })
      ) {
        continue
      }
      if (
        subBlockConfig?.condition &&
        !evaluateSubBlockCondition(subBlockConfig.condition, subBlockValues)
      ) {
        continue
      }

      const canonicalSubBlockId =
        canonicalIndex.canonicalIdBySubBlockId[subBlockId] ??
        subBlockConfig?.canonicalParamId ??
        subBlockId
      const value = subBlockState?.value
      const subBlockType = subBlockConfig?.type ?? subBlockState.type
      if (DISPLAY_ONLY_SUBBLOCK_TYPES.has(subBlockType)) continue
      const resourceSubBlockConfig = subBlockConfig ?? { type: subBlockType }
      const structuredResourceKind = getResourceKindForSubBlock(resourceSubBlockConfig)

      if (subBlockType === 'tool-input') {
        addToolInputMatches({
          matches,
          block,
          subBlockId,
          canonicalSubBlockId,
          value,
          mode,
          query,
          caseSensitive,
          includeResourceMatchesWithoutQuery,
          resourceQueryEnabled,
          editable,
          protectedByLock,
          isSnapshotView,
          readonlyReason,
          workspaceId,
          workflowId,
          credentialTypeById,
          blockConfigs,
        })
        continue
      }

      if (mode !== 'resource' && !structuredResourceKind) {
        const textLeaves = getTextLeaves(value, subBlockType)
        for (const leaf of textLeaves) {
          const leafEditable = editable && typeof leaf.originalValue === 'string'
          addTextMatches({
            matches,
            idPrefix: 'text',
            block,
            subBlockId,
            canonicalSubBlockId,
            subBlockType,
            fieldTitle: leaf.fieldTitle ?? subBlockConfig?.title,
            value: leaf.value,
            valuePath: leaf.path,
            target: { kind: 'subblock' },
            query,
            caseSensitive,
            editable: leafEditable,
            protectedByLock,
            isSnapshotView,
            readonlyReason: leafEditable
              ? undefined
              : typeof leaf.originalValue === 'string'
                ? readonlyReason
                : 'Only text values can be replaced',
          })
        }
      }

      if (mode === 'text' || !resourceQueryEnabled) continue

      const referenceLeaves = getSearchableStringLeaves(value, subBlockType, 'reference')
      for (const leaf of referenceLeaves) {
        const inlineReferences = parseInlineReferences(leaf.value)
        inlineReferences.forEach((reference, referenceIndex) => {
          const searchable = `${reference.rawValue} ${reference.searchText}`
          if (
            !includeResourceMatchesWithoutQuery &&
            !matchesSearchText(searchable, query, caseSensitive)
          ) {
            return
          }

          matches.push({
            id: createMatchId([
              reference.kind,
              block.id,
              subBlockId,
              pathToKey(leaf.path),
              reference.range.start,
              referenceIndex,
            ]),
            blockId: block.id,
            blockName: block.name,
            blockType: block.type,
            subBlockId,
            canonicalSubBlockId,
            subBlockType: subBlockConfig?.type ?? subBlockState.type,
            fieldTitle: subBlockConfig?.title,
            valuePath: leaf.path,
            target: { kind: 'subblock' },
            kind: reference.kind,
            rawValue: reference.rawValue,
            searchText: reference.searchText,
            range: reference.range,
            resource: reference.resource,
            editable,
            navigable: true,
            protected: protectedByLock,
            reason: getReadonlyReason({ editable, isSnapshotView, readonlyReason }),
          })
        })
      }

      const selectorContext =
        subBlockConfig?.selectorKey || subBlockConfig?.dependsOn
          ? buildSearchSelectorContext({
              block,
              subBlockConfig,
              subBlockValues,
              canonicalIndex,
              workspaceId,
              workflowId,
            })
          : undefined
      const structuredReferences = parseStructuredResourceReferences(
        value,
        resourceSubBlockConfig,
        selectorContext
      )
      structuredReferences.forEach((reference, referenceIndex) => {
        const searchable = `${reference.rawValue} ${reference.searchText} ${reference.kind}`
        if (
          !includeResourceMatchesWithoutQuery &&
          !matchesSearchText(searchable, query, caseSensitive)
        ) {
          return
        }

        matches.push({
          id: createMatchId([
            reference.kind,
            block.id,
            subBlockId,
            reference.rawValue,
            referenceIndex,
          ]),
          blockId: block.id,
          blockName: block.name,
          blockType: block.type,
          subBlockId,
          canonicalSubBlockId,
          subBlockType: subBlockConfig?.type ?? subBlockState.type,
          fieldTitle: subBlockConfig?.title,
          valuePath: [],
          target: { kind: 'subblock' },
          kind: reference.kind,
          rawValue: reference.rawValue,
          searchText: reference.searchText,
          structuredOccurrenceIndex: referenceIndex,
          resource: reference.resource,
          editable,
          navigable: true,
          protected: protectedByLock,
          reason: getReadonlyReason({ editable, isSnapshotView, readonlyReason }),
        })
      })
    }
  }

  return matches
}
