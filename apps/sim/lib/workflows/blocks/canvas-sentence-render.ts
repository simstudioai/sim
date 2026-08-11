import {
  getCardSubBlocks,
  getSeededSubBlockValues,
} from '@/lib/workflows/blocks/canvas-card-fields'
import { type CardSelector, resolveCanvasSentence } from '@/lib/workflows/blocks/canvas-sentence'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

/**
 * Renders the readings a canvas sentence actually has on a card.
 *
 * The single definition of what a sentence "says". Validation compares
 * operations through it, the CI check prints it, and the audit corpus builder
 * hands it to reviewers.
 *
 * It delegates to `resolveCanvasSentence` rather than walking the clauses
 * itself, because every previous version was a second implementation that
 * drifted: one modelled the superseded `required`/`fallback` DSL and reported
 * zero empty sentences while 3,146 cards painted nothing; its replacement
 * ignored field visibility and printed healthy prose for 35 cards that render
 * nothing at all. A reviewer reading output from a different renderer than the
 * card uses is reviewing fiction, so there is now only one renderer.
 */

export interface SentenceReadings {
  /** Every on-card slot populated. */
  filled: string
  /**
   * Nothing filled in — how a card reads as first dropped.
   *
   * Always a string, never `null` for "same as filled": the duplicate-detection
   * rule groups operations by this, and a reading that sometimes fell back to
   * `filled` would compare noun-form against fieldId-form and miss collisions.
   */
  bare: string
}

type RenderableConfig = Pick<
  BlockConfig,
  'subBlocks' | 'category' | 'triggers' | 'canvasPresentation'
>

function toProse(
  segments: ReturnType<typeof resolveCanvasSentence>,
  slotText: (subBlockId: string, noun?: string) => string
): string {
  if (!segments) return ''
  return segments
    .map((segment) =>
      typeof segment === 'string' ? segment : slotText(segment.subBlockId, segment.noun)
    )
    .join(' ')
    .replace(/\s+([,.])/g, '$1')
    .trim()
}

/**
 * Both readings of one operation's sentence, as the card paints them.
 *
 * @param operationSubBlockId - The operation dropdown, or `null` for a block
 *   without one. Needed so the on-card set is computed for the right operation.
 * @param card - Which card to read: an action operation, or trigger mode, which
 *   swaps the subblock set and the sentence together.
 */
export function renderSentenceReadings(
  config: RenderableConfig,
  operationSubBlockId: string | null,
  card: CardSelector
): SentenceReadings {
  const values = getSeededSubBlockValues(config)
  if (card.mode === 'action' && operationSubBlockId) {
    values[operationSubBlockId] = card.operationValue
  }

  const onCardById = new Map<string, SubBlockConfig>()
  for (const subBlock of getCardSubBlocks(config, {
    advanced: false,
    values,
    canonicalIndex: buildCanonicalIndex(config.subBlocks),
    triggerMode: card.mode === 'trigger',
  })) {
    if (!onCardById.has(subBlock.id)) onCardById.set(subBlock.id, subBlock)
  }
  const getOnCard = (subBlockId: string) => onCardById.get(subBlockId) ?? null

  const filled = resolveCanvasSentence(
    config,
    card,
    (subBlockId) => onCardById.has(subBlockId),
    getOnCard
  )
  const bare = resolveCanvasSentence(config, card, () => false, getOnCard)

  return {
    filled: toProse(filled, (subBlockId) => `⟨${subBlockId}⟩`),
    bare: toProse(bare, (_subBlockId, noun) => `⟨${noun ?? ''}⟩`),
  }
}
