import type { SubBlockType } from '@sim/workflow-types/blocks'
import { isWorkflowBlockProtected } from '@sim/workflow-types/workflow'
import {
  getResourceKindForSubBlock,
  matchesSearchText,
  parseInlineReferences,
  parseStructuredResourceReferences,
} from '@/lib/workflows/search-replace/reference-registry'
import { getWorkflowSearchSubflowFields } from '@/lib/workflows/search-replace/subflow-fields'
import type {
  WorkflowSearchBlockState,
  WorkflowSearchIndexerOptions,
  WorkflowSearchMatch,
  WorkflowSearchValuePath,
} from '@/lib/workflows/search-replace/types'
import { pathToKey, walkStringValues } from '@/lib/workflows/search-replace/value-walker'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'

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

function isSearchableLeafPath(path: Array<string | number>): boolean {
  const lastSegment = path.at(-1)
  if (typeof lastSegment !== 'string') return true
  return !STRUCTURED_METADATA_LEAF_KEYS.has(lastSegment)
}

function getSearchableStringLeaves(value: unknown) {
  return walkStringValues(value).filter((leaf) => isSearchableLeafPath(leaf.path))
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

function buildSearchSelectorContext({
  block,
  subBlockConfigs,
  workspaceId,
  workflowId,
}: {
  block: WorkflowSearchBlockState
  subBlockConfigs: SubBlockConfig[]
  workspaceId?: string
  workflowId?: string
}): SelectorContext {
  const context: SelectorContext = {}
  if (workspaceId) context.workspaceId = workspaceId
  if (workflowId) context.workflowId = workflowId

  const canonicalIndex = buildCanonicalIndex(subBlockConfigs)
  for (const [subBlockId, subBlock] of Object.entries(block.subBlocks ?? {})) {
    const value = subBlock?.value
    if (value === null || value === undefined) continue
    const stringValue = typeof value === 'string' ? value : String(value)
    if (!stringValue) continue

    const canonicalKey = canonicalIndex.canonicalIdBySubBlockId[subBlockId] ?? subBlockId
    if (SELECTOR_CONTEXT_FIELDS.has(canonicalKey as keyof SelectorContext)) {
      context[canonicalKey as keyof SelectorContext] = stringValue
    }
  }

  return context
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
  } = options

  const matches: WorkflowSearchMatch[] = []
  const resourceQueryEnabled = includeResourceMatchesWithoutQuery || Boolean(query)

  for (const block of Object.values(workflow.blocks)) {
    const blockConfig = blockConfigs[block.type] ?? getBlock(block.type)
    const subBlockConfigs = blockConfig?.subBlocks ?? []
    const configsById = new Map(subBlockConfigs.map((subBlock) => [subBlock.id, subBlock]))
    const canonicalIndex = buildCanonicalIndex(subBlockConfigs)
    const selectorContext = buildSearchSelectorContext({
      block,
      subBlockConfigs,
      workspaceId,
      workflowId,
    })
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
      const subBlockConfig = configsById.get(subBlockId)
      const canonicalSubBlockId =
        canonicalIndex.canonicalIdBySubBlockId[subBlockId] ??
        subBlockConfig?.canonicalParamId ??
        subBlockId
      const value = subBlockState?.value
      const stringLeaves = getSearchableStringLeaves(value)
      const structuredResourceKind = getResourceKindForSubBlock(subBlockConfig)

      if (mode !== 'resource' && !structuredResourceKind) {
        for (const leaf of stringLeaves) {
          const leafEditable = editable && typeof leaf.originalValue === 'string'
          addTextMatches({
            matches,
            idPrefix: 'text',
            block,
            subBlockId,
            canonicalSubBlockId,
            subBlockType: subBlockConfig?.type ?? subBlockState.type,
            fieldTitle: subBlockConfig?.title,
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

      for (const leaf of stringLeaves) {
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

      const structuredReferences = parseStructuredResourceReferences(
        value,
        subBlockConfig,
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
