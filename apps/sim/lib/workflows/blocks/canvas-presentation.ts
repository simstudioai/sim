import { resolveDropdownLabel } from '@/lib/workflows/subblocks/display'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

type CanvasPresentationConfig = Pick<BlockConfig, 'name' | 'subBlocks' | 'canvasPresentation'>

export interface CanvasBlockPresentation {
  title: string
  typeLabel: string
  /**
   * Whether the heading already names the operation, so the operation row would
   * only repeat it. Not "the title was auto-derived" — a block *named* for its
   * operation also satisfies this, and one the user renamed does not.
   */
  titleShowsOperation: boolean
  operationSubBlockId?: string
  operationRowTitle?: string
}

function getOperationTitle(
  subBlocks: SubBlockConfig[],
  operationSubBlockId: string | undefined,
  rawValues: Record<string, unknown>
): string | null {
  if (!operationSubBlockId) return null
  const operationSubBlock = subBlocks.find((subBlock) => subBlock.id === operationSubBlockId)
  return resolveDropdownLabel(operationSubBlock, rawValues[operationSubBlockId])
}

/**
 * The name a newly-added block is given.
 *
 * The operation a fresh block seeds to, so a Gmail block is called "Send Email"
 * rather than "Gmail 1" — the name a user reads on the card, in the reference
 * dropdown and in `<sendemail.content>` is then the same string. Falls back to
 * the block's declared default title, then to its registry name.
 *
 * Only applied at creation. Existing blocks keep whatever they were called.
 */
export function getDefaultBlockName(config: CanvasPresentationConfig): string {
  const presentation = config.canvasPresentation
  if (!presentation) return config.name

  const seeded: Record<string, unknown> = {}
  for (const subBlock of config.subBlocks) {
    if (typeof subBlock.value === 'function') {
      try {
        seeded[subBlock.id] = subBlock.value({})
      } catch {
        /* A generator needing values cannot run here; the fallbacks cover it. */
      }
    } else if (subBlock.defaultValue !== undefined) {
      seeded[subBlock.id] = subBlock.defaultValue
    }
  }

  const operationTitle = getOperationTitle(
    config.subBlocks,
    presentation.operationSubBlockId,
    seeded
  )
  return operationTitle ?? presentation.defaultTitle ?? config.name
}

/** Resolves semantic canvas copy without changing the block's persisted internal name. */
export function resolveCanvasBlockPresentation(
  config: CanvasPresentationConfig,
  storedName: string,
  rawValues: Record<string, unknown>
): CanvasBlockPresentation {
  const presentation = config.canvasPresentation
  if (!presentation) {
    return {
      title: storedName,
      typeLabel: config.name,
      titleShowsOperation: false,
    }
  }

  /*
   * The heading is the block's own name, always. It used to float to the current
   * operation whenever the name looked auto-generated, so a card headed "Send
   * Email" was referenced as `<gmail1.content>` — the canvas and the tag dropdown
   * disagreed about what the block was called. Keeping them identical also means
   * a name a user typed needs no special case: it is simply the name.
   */
  const title = storedName
  const operationTitle = getOperationTitle(
    config.subBlocks,
    presentation.operationSubBlockId,
    rawValues
  )

  /*
   * The operation row is redundant only while the heading is already saying it.
   * Keyed on the rendered title rather than on how the name was produced, so a
   * block *named* "Send Email" hides the row, and one a user renamed to
   * "Notify the team" shows it again.
   *
   * The `2` in "Send Email 2" only tells two cards apart, so it is ignored here
   * — the second Gmail block is still sending an email and does not need a row
   * repeating it.
   */
  const titleWithoutCopyNumber = title.replace(/\s+\d+$/, '')
  const titleShowsOperation = Boolean(
    operationTitle && (title === operationTitle || titleWithoutCopyNumber === operationTitle)
  )

  return {
    title,
    typeLabel: presentation.typeLabel ?? config.name,
    titleShowsOperation,
    operationSubBlockId: presentation.operationSubBlockId,
    operationRowTitle: presentation.operationRowTitle,
  }
}
