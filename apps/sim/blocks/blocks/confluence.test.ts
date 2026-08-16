/**
 * @vitest-environment node
 *
 * Schema gating for the Confluence blocks' page selector.
 *
 * Expectations are derived from the tool contracts rather than hand-copied
 * operation lists, so adding an operation that consumes a page id fails here
 * until the block's `condition` is widened to match.
 */
import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { ConfluenceBlock, ConfluenceV2Block } from '@/blocks/blocks/confluence'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import {
  confluenceAddLabelTool,
  confluenceCreateBlogPostTool,
  confluenceCreateCommentTool,
  confluenceCreatePagePropertyTool,
  confluenceCreatePageTool,
  confluenceCreateSpacePropertyTool,
  confluenceCreateSpaceTool,
  confluenceDeleteAttachmentTool,
  confluenceDeleteBlogPostTool,
  confluenceDeleteCommentTool,
  confluenceDeleteLabelTool,
  confluenceDeletePagePropertyTool,
  confluenceDeletePageTool,
  confluenceDeleteSpacePropertyTool,
  confluenceDeleteSpaceTool,
  confluenceGetBlogPostTool,
  confluenceGetPageAncestorsTool,
  confluenceGetPageChildrenTool,
  confluenceGetPageDescendantsTool,
  confluenceGetPagesByLabelTool,
  confluenceGetPageVersionTool,
  confluenceGetSpaceTool,
  confluenceGetTaskTool,
  confluenceGetUserTool,
  confluenceListAttachmentsTool,
  confluenceListBlogPostsInSpaceTool,
  confluenceListBlogPostsTool,
  confluenceListCommentsTool,
  confluenceListLabelsTool,
  confluenceListPagePropertiesTool,
  confluenceListPagesInSpaceTool,
  confluenceListPageVersionsTool,
  confluenceListSpaceLabelsTool,
  confluenceListSpacePermissionsTool,
  confluenceListSpacePropertiesTool,
  confluenceListSpacesTool,
  confluenceListTasksTool,
  confluenceRetrieveTool,
  confluenceSearchInSpaceTool,
  confluenceSearchTool,
  confluenceUpdateBlogPostTool,
  confluenceUpdateCommentTool,
  confluenceUpdateSpaceTool,
  confluenceUpdateTaskTool,
  confluenceUpdateTool,
  confluenceUploadAttachmentTool,
} from '@/tools/confluence'
import type { ToolConfig } from '@/tools/types'

/**
 * Confluence tools keyed by id. Imported directly rather than through
 * `@/tools/registry`, which `vitest.setup.ts` mocks to `{}` for import cost —
 * going through the registry would make every contract assertion pass vacuously.
 */
const TOOLS_BY_ID = new Map<string, ToolConfig>(
  (
    [
      confluenceAddLabelTool,
      confluenceCreateBlogPostTool,
      confluenceCreateCommentTool,
      confluenceCreatePagePropertyTool,
      confluenceCreatePageTool,
      confluenceCreateSpacePropertyTool,
      confluenceCreateSpaceTool,
      confluenceDeleteAttachmentTool,
      confluenceDeleteBlogPostTool,
      confluenceDeleteCommentTool,
      confluenceDeleteLabelTool,
      confluenceDeletePagePropertyTool,
      confluenceDeletePageTool,
      confluenceDeleteSpacePropertyTool,
      confluenceDeleteSpaceTool,
      confluenceGetBlogPostTool,
      confluenceGetPageAncestorsTool,
      confluenceGetPageChildrenTool,
      confluenceGetPageDescendantsTool,
      confluenceGetPageVersionTool,
      confluenceGetPagesByLabelTool,
      confluenceGetSpaceTool,
      confluenceGetTaskTool,
      confluenceGetUserTool,
      confluenceListAttachmentsTool,
      confluenceListBlogPostsInSpaceTool,
      confluenceListBlogPostsTool,
      confluenceListCommentsTool,
      confluenceListLabelsTool,
      confluenceListPagePropertiesTool,
      confluenceListPageVersionsTool,
      confluenceListPagesInSpaceTool,
      confluenceListSpaceLabelsTool,
      confluenceListSpacePermissionsTool,
      confluenceListSpacePropertiesTool,
      confluenceListSpacesTool,
      confluenceListTasksTool,
      confluenceRetrieveTool,
      confluenceSearchInSpaceTool,
      confluenceSearchTool,
      confluenceUpdateBlogPostTool,
      confluenceUpdateCommentTool,
      confluenceUpdateSpaceTool,
      confluenceUpdateTaskTool,
      confluenceUpdateTool,
      confluenceUploadAttachmentTool,
    ] as ToolConfig[]
  ).map((tool) => [tool.id, tool])
)

/**
 * V2 operations that render a page target today but consume no page id: `create`
 * and `create_blogpost` produce one, and the comment/attachment mutations address
 * their own id. `list_tasks` accepts an optional page filter but has always been
 * hidden — un-hiding it would make a stale stored value start filtering, so it
 * stays out.
 */
const V2_PAGE_HIDDEN_OPERATIONS = [
  'create',
  'create_blogpost',
  'update_comment',
  'delete_comment',
  'delete_attachment',
] as const

const PAGE_MEMBERS = ['pageId', 'manualPageId'] as const

const operationOptions = (block: BlockConfig) =>
  block.subBlocks.find((sb) => sb.id === 'operation')?.options as Array<{
    id: string
    label: string
  }>

const operationIdsOf = (block: BlockConfig) => operationOptions(block).map((o) => o.id)

const subBlockOf = (block: BlockConfig, id: string): SubBlockConfig => {
  const found = block.subBlocks.find((sb) => sb.id === id)
  if (!found) throw new Error(`Block has no subblock "${id}"`)
  return found
}

const isVisibleFor = (sb: SubBlockConfig, operation: string): boolean =>
  evaluateSubBlockCondition(sb.condition, { operation })

const isRequiredFor = (sb: SubBlockConfig, operation: string): boolean => {
  if (typeof sb.required === 'boolean') return sb.required
  if (!sb.required) return false
  return evaluateSubBlockCondition(sb.required, { operation })
}

/**
 * Field ids a canvas sentence names for one operation, flattening the
 * basic/advanced pairs that a clause may reference as a tuple.
 */
const sentenceFieldsFor = (block: BlockConfig, operation: string): string[] => {
  const clauses = block.canvasPresentation?.sentences?.byOperation?.[operation] ?? []
  return clauses.flatMap((clause) =>
    typeof clause === 'string' || !clause.field ? [] : [clause.field].flat()
  )
}

const toolIdFor = (block: BlockConfig, operation: string): string =>
  (block.tools.config?.tool as (params: Record<string, string>) => string)({ operation })

const toolRequiresParam = (block: BlockConfig, operation: string, paramId: string): boolean => {
  const toolId = toolIdFor(block, operation)
  const tool = TOOLS_BY_ID.get(toolId)
  if (!tool) throw new Error(`No imported tool for "${toolId}" (operation "${operation}")`)
  return Boolean(tool.params?.[paramId]?.required)
}

describe('Confluence v2 page-selector gating', () => {
  const operationIds = operationIdsOf(ConfluenceV2Block)

  it('resolves every operation to an imported tool', () => {
    const unresolved = operationIds.filter(
      (operation) => !TOOLS_BY_ID.has(toolIdFor(ConfluenceV2Block, operation))
    )
    expect(unresolved).toEqual([])
  })

  it.each(operationIds)(
    'shows the page target for %s exactly when its tool requires pageId',
    (operation) => {
      const required = toolRequiresParam(ConfluenceV2Block, operation, 'pageId')
      for (const id of PAGE_MEMBERS) {
        expect(
          isVisibleFor(subBlockOf(ConfluenceV2Block, id), operation),
          required
            ? `"${id}" must render for "${operation}", whose tool requires pageId`
            : `"${id}" must not render for "${operation}", whose tool takes no required pageId`
        ).toBe(required)
      }
    }
  )

  it.each(V2_PAGE_HIDDEN_OPERATIONS)('hides the page target for %s', (operation) => {
    expect(toolRequiresParam(ConfluenceV2Block, operation, 'pageId')).toBe(false)
    for (const id of PAGE_MEMBERS) {
      expect(isVisibleFor(subBlockOf(ConfluenceV2Block, id), operation)).toBe(false)
    }
  })

  it('keeps the dedicated parent field on create, where the page target is gone', () => {
    expect(isVisibleFor(subBlockOf(ConfluenceV2Block, 'pageId'), 'create')).toBe(false)
    expect(isVisibleFor(subBlockOf(ConfluenceV2Block, 'parentId'), 'create')).toBe(true)
  })

  it('is visible on every operation where it is required', () => {
    for (const id of PAGE_MEMBERS) {
      const sb = subBlockOf(ConfluenceV2Block, id)
      for (const operation of operationIds) {
        if (!isRequiredFor(sb, operation)) continue
        expect(isVisibleFor(sb, operation)).toBe(true)
      }
    }
  })

  it('renders both canonical twins identically', () => {
    const basic = subBlockOf(ConfluenceV2Block, 'pageId')
    const advanced = subBlockOf(ConfluenceV2Block, 'manualPageId')
    expect(advanced.canonicalParamId).toBe(basic.canonicalParamId)
    expect(advanced.dependsOn).toEqual(basic.dependsOn)
    for (const operation of operationIds) {
      expect(isVisibleFor(advanced, operation)).toBe(isVisibleFor(basic, operation))
      expect(isRequiredFor(advanced, operation)).toBe(isRequiredFor(basic, operation))
    }
  })

  it.each(operationIds)('%s leaves every rendered dependency satisfiable', (operation) => {
    const visible = ConfluenceV2Block.subBlocks.filter((sb) => isVisibleFor(sb, operation))
    const visibleIds = new Set(visible.map((sb) => sb.id))
    for (const sb of visible) {
      const deps = Array.isArray(sb.dependsOn) ? sb.dependsOn : []
      for (const dep of deps) {
        const depConfigs = ConfluenceV2Block.subBlocks.filter(
          (candidate) => candidate.id === dep || candidate.canonicalParamId === dep
        )
        expect(
          depConfigs.some((candidate) => visibleIds.has(candidate.id)),
          `"${sb.id}" renders for "${operation}" but its dependency "${dep}" does not`
        ).toBe(true)
      }
    }
  })

  it.each(operationIds)('%s names only fields its canvas sentence can render', (operation) => {
    for (const field of sentenceFieldsFor(ConfluenceV2Block, operation)) {
      const sb = ConfluenceV2Block.subBlocks.find((candidate) => candidate.id === field)
      if (!sb) continue
      expect(isVisibleFor(sb, operation), `"${field}" is named but never renders`).toBe(true)
    }
  })

  it('uses the Get convention for the single-page read', () => {
    const label = operationOptions(ConfluenceV2Block).find((o) => o.id === 'read')?.label
    expect(label).toBe('Get Page')
    expect(toolIdFor(ConfluenceV2Block, 'read')).toBe('confluence_retrieve')
  })
})

describe('legacy Confluence block', () => {
  const operationIds = operationIdsOf(ConfluenceBlock)

  it('is sunset in favour of confluence_v2', () => {
    expect(ConfluenceBlock.hideFromToolbar).toBe(true)
    expect(ConfluenceBlock.sunset?.replacedBy).toBe('confluence_v2')
  })

  it('gates the page target instead of rendering it on every operation', () => {
    for (const id of PAGE_MEMBERS) {
      const sb = subBlockOf(ConfluenceBlock, id)
      expect(sb.condition).toBeDefined()
      const hidden = operationIds.filter((operation) => !isVisibleFor(sb, operation))
      expect(hidden.length).toBeGreaterThan(0)
    }
  })

  it.each(operationIds)(
    'shows the page target for %s exactly when its tool requires pageId',
    (operation) => {
      const required = toolRequiresParam(ConfluenceBlock, operation, 'pageId')
      for (const id of PAGE_MEMBERS) {
        expect(
          isVisibleFor(subBlockOf(ConfluenceBlock, id), operation),
          required
            ? `"${id}" must render for "${operation}", whose tool requires pageId`
            : `"${id}" must not render for "${operation}", whose tool takes no required pageId`
        ).toBe(required)
      }
    }
  )

  it.each(operationIds)('%s names only fields its canvas sentence can render', (operation) => {
    for (const field of sentenceFieldsFor(ConfluenceBlock, operation)) {
      const sb = ConfluenceBlock.subBlocks.find((candidate) => candidate.id === field)
      if (!sb) continue
      expect(isVisibleFor(sb, operation), `"${field}" is named but never renders`).toBe(true)
    }
  })

  it('keeps its own operation labels untouched', () => {
    const label = operationOptions(ConfluenceBlock).find((o) => o.id === 'read')?.label
    expect(label).toBe('Read Page')
  })
})
