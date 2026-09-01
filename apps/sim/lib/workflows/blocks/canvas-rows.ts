import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

/**
 * Which sections a collapsed canvas card renders.
 *
 * Auto-layout has to reach the same answer as the renderer before a block has
 * ever mounted — the deterministic height it feeds `calculateWorkflowBlockDimensions`
 * is what spaces the graph, so a rule that lives only in the card component
 * lays every unrendered block out against a card it does not paint.
 */

/**
 * Selector subblock types whose hydrated value names the block's primary
 * target (table, channel, knowledge base, …) — promoted to a chip.
 */
const CHIP_TARGET_SELECTOR_TYPES = new Set<string>([
  'table-selector',
  'knowledge-base-selector',
  'workflow-selector',
  'mcp-server-selector',
  'mcp-tool-selector',
  'channel-selector',
  'user-selector',
  'file-selector',
  'sheet-selector',
  'folder-selector',
  'project-selector',
  'document-selector',
])

/** Maximum fragments in the statement line; remaining candidates fall back to rows. */
const MAX_CHIPS = 2

/**
 * Ranks a subblock for promotion into the card's chips row: the operation
 * first, then the primary target selector, then the model. Returns null for
 * subblocks that stay as label/value rows.
 */
function chipPriority(subBlock: SubBlockConfig): number | null {
  if (subBlock.id === 'operation') return 0
  if (CHIP_TARGET_SELECTOR_TYPES.has(subBlock.type)) return 1
  if (subBlock.id === 'model') return 2
  return null
}

/** Whether the card exposes the standard input/output ports. */
export function showsCanvasDefaultHandles(
  config: Pick<BlockConfig, 'category'>,
  type: string,
  displayTriggerMode: boolean
): boolean {
  return config.category !== 'triggers' && type !== 'starter' && !displayTriggerMode
}

/**
 * Whether the card carries the error-output row. Permanent for blocks that can
 * emit an error — it is the affordance for switching the output on — so it
 * holds a row whether or not the toggle is set.
 */
export function showsCanvasErrorRow(
  config: Pick<BlockConfig, 'category'>,
  type: string,
  displayTriggerMode: boolean
): boolean {
  return showsCanvasDefaultHandles(config, type, displayTriggerMode) && type !== 'response'
}

interface CanvasChipSplitOptions {
  titleShowsOperation: boolean
  operationSubBlockId?: string
}

/**
 * Splits the card's visible subblocks into the chips row and the label/value
 * rows below it. The chips row is one fixed-height section no matter how many
 * chips land in it, so the split changes the card's height.
 */
export function splitCanvasChipBlocks(
  visibleSubBlocks: SubBlockConfig[],
  { titleShowsOperation, operationSubBlockId }: CanvasChipSplitOptions
): { chipBlocks: SubBlockConfig[]; rowSubBlocks: SubBlockConfig[] } {
  const chipBlocks = visibleSubBlocks
    .filter((block) => titleShowsOperation || block.id !== operationSubBlockId)
    .filter((block) => chipPriority(block) !== null)
    .sort((a, b) => (chipPriority(a) ?? 0) - (chipPriority(b) ?? 0))
    .slice(0, MAX_CHIPS)
  const chipIds = new Set(chipBlocks.map((block) => block.id))

  return {
    chipBlocks,
    rowSubBlocks: visibleSubBlocks.filter((block) => !chipIds.has(block.id)),
  }
}
