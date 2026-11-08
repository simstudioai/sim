import { createLogger } from '@sim/logger'

const logger = createLogger('ConditionBlocks')

/**
 * One branch of a Condition block (`if` / `else if` / `else`) or one route of a Router block, as the
 * sub-block stores it. The stored JSON carries the editor's picker state beside `id`, `title` and
 * `value`, in this key order; the canvas reads the ids for its branch handles and the executor reads
 * `title` and `value`, so the shape is kept exactly as the legacy editor writes it.
 */
export interface ConditionalBlock {
  id: string
  title: string
  value: string
  showTags: boolean
  showEnvVars: boolean
  searchTerm: string
  cursorPosition: number
  activeSourceBlockId: string | null
}

/** Whether the field edits a Condition block's branches or a Router block's routes. */
export type ConditionInputMode = 'condition' | 'router'

/** The branch id the canvas keys a handle on: the block id and a stable suffix. */
function branchId(blockId: string, suffix: string): string {
  return `${blockId}-${suffix}`
}

function emptyBranch(id: string, title: string): ConditionalBlock {
  return {
    id,
    title,
    value: '',
    showTags: false,
    showEnvVars: false,
    searchTerm: '',
    cursorPosition: 0,
    activeSourceBlockId: null,
  }
}

/** A new Condition gets `if` and `else`; a new Router gets one route. */
export function createDefaultConditionBlocks(
  blockId: string,
  mode: ConditionInputMode
): ConditionalBlock[] {
  if (mode === 'router') return [emptyBranch(branchId(blockId, 'route1'), 'route1')]
  return [
    emptyBranch(branchId(blockId, 'if'), 'if'),
    emptyBranch(branchId(blockId, 'else'), 'else'),
  ]
}

/** An empty branch inserted by Add: an `else if` for a Condition, a named route for a Router. */
export function createConditionBranch(blockId: string, mode: ConditionInputMode): ConditionalBlock {
  const stamp = Date.now()
  return mode === 'router'
    ? emptyBranch(branchId(blockId, `route-${stamp}`), `route-${stamp}`)
    : emptyBranch(branchId(blockId, `else-if-${stamp}`), '')
}

/**
 * Titles a Condition's branches by position: the first is `if`, the last `else`, the rest
 * `else if`. A Router's route titles are the author's and stay as they are.
 */
export function withConditionTitles(
  blocks: ConditionalBlock[],
  mode: ConditionInputMode
): ConditionalBlock[] {
  if (mode === 'router') return blocks
  return blocks.map((block, index) => ({
    ...block,
    title: index === 0 ? 'if' : index === blocks.length - 1 ? 'else' : 'else if',
  }))
}

/**
 * The stored text of the sub-block, or `null` when it holds nothing yet. An array a tool wrote
 * directly is read as its JSON.
 */
export function conditionValueText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return JSON.stringify(value)
  return String(value)
}

/** The stored branches, or `null` when the text is not a branch list. */
export function parseConditionBlocks(json: string): ConditionalBlock[] | null {
  if (!json) return null
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const first: unknown = parsed[0]
    if (typeof first !== 'object' || first === null || !('id' in first) || !('title' in first)) {
      return null
    }
    return parsed as ConditionalBlock[]
  } catch (error) {
    logger.error('Failed to parse condition branches', { error })
    return null
  }
}
