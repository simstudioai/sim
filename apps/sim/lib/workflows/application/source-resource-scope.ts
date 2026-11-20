/**
 * Resource ids a workflow source writes verbatim (`tableId: 'tbl_…'` rather than
 * `table('leads')`) are not resolved through the workspace's resource keys, so an id copied from
 * another workspace would be saved as is and fail only when the block runs. An apply checks the
 * ids the edit itself writes against the workflow's own workspace and refuses one it does not
 * hold, the way materialize refuses a key with no resource (`E_MAT_UNKNOWN_RESOURCE`).
 */
import { db } from '@sim/db'
import { knowledgeBase, userTableDefinitions, workflow } from '@sim/db/schema'
import type { Diagnostic } from '@sim/workflow-code'
import type { BlockState } from '@sim/workflow-types/workflow'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { GraphDiff } from '@/lib/workflows/code/apply/graph-diff'
import { getBlock } from '@/blocks/registry'

/** The workspace-owned resources a block names by id, by the picker type that names them. */
const SCOPED_SELECTORS = {
  'table-selector': { noun: 'table', plural: 'tables', example: "table('leads')" },
  'workflow-selector': {
    noun: 'workflow',
    plural: 'workflows',
    example: "childWorkflow('report')",
  },
  'knowledge-base-selector': {
    noun: 'knowledge base',
    plural: 'knowledge bases',
    example: "knowledgeBase('docs')",
  },
} as const

type ScopedSelector = keyof typeof SCOPED_SELECTORS

function isScopedSelector(type: string): type is ScopedSelector {
  return Object.hasOwn(SCOPED_SELECTORS, type)
}

/** One verbatim id a changed field writes. */
interface NamedId {
  selector: ScopedSelector
  id: string
  blockId: string
  /** The param the source writes it under (the field's canonical param, else its id). */
  param: string
}

/**
 * The fields of a block type that hold a scoped resource id, by subblock id: each picker, and
 * the free-text twin sharing its canonical param (a manual table id).
 */
function scopedFields(blockType: string): Map<string, { selector: ScopedSelector; param: string }> {
  const fields = new Map<string, { selector: ScopedSelector; param: string }>()
  const subBlocks = getBlock(blockType)?.subBlocks ?? []
  const byParam = new Map<string, ScopedSelector>()
  for (const subBlock of subBlocks) {
    if (!isScopedSelector(subBlock.type)) continue
    fields.set(subBlock.id, {
      selector: subBlock.type,
      param: subBlock.canonicalParamId ?? subBlock.id,
    })
    if (subBlock.canonicalParamId) byParam.set(subBlock.canonicalParamId, subBlock.type)
  }
  for (const subBlock of subBlocks) {
    const selector = subBlock.canonicalParamId ? byParam.get(subBlock.canonicalParamId) : undefined
    if (selector && !fields.has(subBlock.id)) {
      fields.set(subBlock.id, { selector, param: subBlock.canonicalParamId ?? subBlock.id })
    }
  }
  return fields
}

/** The verbatim ids a stored field value holds: none for a reference, an env token or empty. */
function idsOf(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim())
      : []
  return items.filter(
    (item): item is string =>
      typeof item === 'string' && item !== '' && !item.includes('<') && !item.includes('{{')
  )
}

/** The ids among `ids` that the workspace holds as live resources of `selector`'s kind. */
async function heldIds(
  selector: ScopedSelector,
  ids: string[],
  workspaceId: string
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows =
    selector === 'table-selector'
      ? await db
          .select({ id: userTableDefinitions.id })
          .from(userTableDefinitions)
          .where(
            and(
              inArray(userTableDefinitions.id, ids),
              eq(userTableDefinitions.workspaceId, workspaceId),
              isNull(userTableDefinitions.archivedAt)
            )
          )
      : selector === 'workflow-selector'
        ? await db
            .select({ id: workflow.id })
            .from(workflow)
            .where(
              and(
                inArray(workflow.id, ids),
                eq(workflow.workspaceId, workspaceId),
                isNull(workflow.archivedAt)
              )
            )
        : await db
            .select({ id: knowledgeBase.id })
            .from(knowledgeBase)
            .where(
              and(
                inArray(knowledgeBase.id, ids),
                eq(knowledgeBase.workspaceId, workspaceId),
                isNull(knowledgeBase.deletedAt)
              )
            )
  return new Set(rows.map((row) => row.id))
}

/**
 * `E_MAT_UNKNOWN_RESOURCE` for each table, workflow or knowledge base id a block this apply adds,
 * or a field it changes, writes verbatim that is not a live resource of `workspaceId`. An id an
 * enclosing apply creates first (`pendingIds`) counts as held; a field the apply leaves alone is
 * not checked, so a stored dangling id only refuses the edit that writes it.
 */
export async function foreignResourceRefusals(input: {
  blocks: Readonly<Record<string, BlockState>>
  diff: GraphDiff
  workspaceId: string
  pendingIds: ReadonlySet<string>
  keyOf: (blockId: string) => string | undefined
}): Promise<Diagnostic[]> {
  const changedFields = new Map<string, ReadonlySet<string> | 'all'>([
    ...input.diff.added.map((id) => [id, 'all'] as const),
    ...input.diff.modified.map((change) => [change.id, new Set(change.subBlocks)] as const),
  ])
  const named: NamedId[] = []
  for (const [blockId, changed] of changedFields) {
    const block = input.blocks[blockId]
    if (!block) continue
    for (const [fieldId, field] of scopedFields(block.type)) {
      if (changed !== 'all' && !changed.has(fieldId)) continue
      for (const id of idsOf(block.subBlocks?.[fieldId]?.value)) {
        if (!input.pendingIds.has(id)) named.push({ ...field, id, blockId })
      }
    }
  }
  if (named.length === 0) return []
  const held = new Map<ScopedSelector, Set<string>>()
  for (const selector of Object.keys(SCOPED_SELECTORS) as ScopedSelector[]) {
    const ids = [
      ...new Set(named.flatMap((entry) => (entry.selector === selector ? [entry.id] : []))),
    ]
    held.set(selector, await heldIds(selector, ids, input.workspaceId))
  }
  return named.flatMap(({ selector, id, blockId, param }): Diagnostic[] => {
    if (held.get(selector)?.has(id)) return []
    const { noun, plural, example } = SCOPED_SELECTORS[selector]
    const blockKey = input.keyOf(blockId)
    return [
      {
        code: 'E_MAT_UNKNOWN_RESOURCE',
        severity: 'error',
        message: `No ${noun} "${id}" in this workspace: ${input.blocks[blockId]?.name ?? 'the block'} names it by id, and a run can only use this workspace's ${plural}.`,
        hint: `Name the ${noun} by its key (${example}), or write the id of a ${noun} in this workspace.`,
        blockId,
        ...(blockKey !== undefined ? { blockKey } : {}),
        param,
      },
    ]
  })
}
