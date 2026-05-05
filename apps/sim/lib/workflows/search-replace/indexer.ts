import {
  matchesSearchText,
  parseInlineReferences,
  parseStructuredResourceReferences,
} from '@/lib/workflows/search-replace/reference-registry'
import type {
  WorkflowSearchIndexerOptions,
  WorkflowSearchMatch,
} from '@/lib/workflows/search-replace/types'
import { pathToKey, walkStringValues } from '@/lib/workflows/search-replace/value-walker'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

function hasLockedAncestor(block: BlockState, blocks: Record<string, BlockState>): boolean {
  let parentId = block.data?.parentId
  const visited = new Set<string>()

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = blocks[parentId]
    if (!parent) return false
    if (parent.locked) return true
    parentId = parent.data?.parentId
  }

  return false
}

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

function buildSearchSelectorContext({
  block,
  subBlockConfigs,
  workspaceId,
  workflowId,
}: {
  block: BlockState
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
    const protectedByLock = Boolean(block.locked || hasLockedAncestor(block, workflow.blocks))
    const editable = !protectedByLock && !isSnapshotView

    for (const [subBlockId, subBlockState] of Object.entries(block.subBlocks ?? {})) {
      const subBlockConfig = configsById.get(subBlockId)
      const canonicalSubBlockId =
        canonicalIndex.canonicalIdBySubBlockId[subBlockId] ??
        subBlockConfig?.canonicalParamId ??
        subBlockId
      const value = subBlockState?.value
      const stringLeaves = walkStringValues(value)

      if (mode !== 'resource') {
        for (const leaf of stringLeaves) {
          const ranges = query ? findTextRanges(leaf.value, query, caseSensitive) : []
          ranges.forEach((range, occurrenceIndex) => {
            matches.push({
              id: createMatchId([
                'text',
                block.id,
                subBlockId,
                pathToKey(leaf.path),
                range.start,
                occurrenceIndex,
              ]),
              blockId: block.id,
              blockName: block.name,
              blockType: block.type,
              subBlockId,
              canonicalSubBlockId,
              subBlockType: subBlockConfig?.type ?? subBlockState.type,
              fieldTitle: subBlockConfig?.title,
              valuePath: leaf.path,
              kind: 'text',
              rawValue: leaf.value.slice(range.start, range.end),
              searchText: leaf.value,
              range,
              editable,
              navigable: true,
              protected: protectedByLock,
              reason: editable
                ? undefined
                : isSnapshotView
                  ? 'Snapshot view is readonly'
                  : 'Block is locked',
            })
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
            kind: reference.kind,
            rawValue: reference.rawValue,
            searchText: reference.searchText,
            range: reference.range,
            resource: reference.resource,
            editable,
            navigable: true,
            protected: protectedByLock,
            reason: editable
              ? undefined
              : isSnapshotView
                ? 'Snapshot view is readonly'
                : 'Block is locked',
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
          kind: reference.kind,
          rawValue: reference.rawValue,
          searchText: reference.searchText,
          resource: reference.resource,
          editable,
          navigable: true,
          protected: protectedByLock,
          reason: editable
            ? undefined
            : isSnapshotView
              ? 'Snapshot view is readonly'
              : 'Block is locked',
        })
      })
    }
  }

  return matches
}
