import { formatQuotedNameList } from '@sim/utils/string'
import type { BlockState } from '@sim/workflow-types/workflow'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'

type SavedBlocks = Record<string, BlockState>

/** At most this many block names are listed when a block selector matches none. */
const MAX_LISTED_BLOCKS = 25

/** `"name" (id)` for each block of `ids`, at most {@link MAX_LISTED_BLOCKS} of them. */
export function listBlocks(blocks: SavedBlocks, ids: string[]): string {
  return formatQuotedNameList(ids, MAX_LISTED_BLOCKS, (id) => `"${blocks[id]?.name ?? id}" (${id})`)
}

/**
 * The ids of the saved blocks `selector` names: its id, else each block whose display name or
 * reference key (the name lowercased, whitespace and dots removed: "Score lead" and `scorelead`)
 * matches it.
 */
function matchBlockSelector(blocks: SavedBlocks, selector: string): string[] {
  if (Object.hasOwn(blocks, selector)) return [selector]
  const key = normalizeWorkflowBlockName(selector)
  return Object.keys(blocks).filter((id) => {
    const name = blocks[id]?.name
    return typeof name === 'string' && normalizeWorkflowBlockName(name) === key
  })
}

/**
 * The id of the one saved block `selector` names ({@link matchBlockSelector}). A selector matching
 * no block, or several, is refused with the candidates, so a caller never has to read block ids
 * out of the stored workflow. `field` names the wire field.
 */
export function resolveBlockSelector(blocks: SavedBlocks, selector: string, field: string): string {
  const matches = matchBlockSelector(blocks, selector)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new OrchestrationError(
      'validation',
      `${field} "${selector}" names ${matches.length} blocks: ${listBlocks(blocks, matches)}. Pass one of their ids.`
    )
  }
  throw new OrchestrationError(
    'validation',
    `${field} "${selector}" is not a block in the current saved workflow. Pass a block's id, name or key: ${listBlocks(blocks, Object.keys(blocks))}.`
  )
}
