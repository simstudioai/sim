import { OPERATION_SUBBLOCK_ID } from '@/lib/permission-groups/operation-access'
import { resolveFieldNoun } from '@/lib/workflows/blocks/canvas-sentence-noun'
import { resolveTriggerSentence } from '@/lib/workflows/blocks/canvas-trigger-sentence'
import type {
  BlockConfig,
  CanvasSentence,
  CanvasSentenceClause,
  SubBlockConfig,
} from '@/blocks/types'

/**
 * Resolves a block's declarative card summary into rendered segments.
 *
 * Pure, so the editor canvas, the sidepanel preview and the docs canvas all
 * reach the same sentence for the same block state. Each surface renders the
 * segments itself, because the value a chip shows is hydrated differently in
 * each (the editor resolves table and credential names through React Query;
 * the preview has no hooks).
 */

/**
 * A literal fragment, or a subblock whose value renders as an inline chip.
 *
 * `noun` is what the chip shows while the field is empty. Its presence is also
 * what marks the segment as core — the card keeps it either way, so the
 * sentence a user reads has the same shape before and after they fill it in.
 */
export type ResolvedSentenceSegment = string | { subBlockId: string; noun?: string }

type CanvasSentenceConfig = Pick<BlockConfig, 'canvasPresentation' | 'subBlocks'>

/**
 * Which card the resolver is painting.
 *
 * A block in trigger mode is not the same card with different values — it has a
 * different subblock set and describes an event rather than an action — so the
 * two are separate variants instead of one nullable operation value.
 */
export type CardSelector =
  | { mode: 'action'; operationValue: unknown }
  | { mode: 'trigger'; triggerId: string | null; triggerName: string | null }

/** A clause's resolved field: which id won, and the definition behind it. */
interface SentenceSlot {
  subBlockId: string
  subBlock: SubBlockConfig
}

/**
 * Finds the subblock whose value selects the block's operation.
 *
 * `canvasPresentation.operationSubBlockId` is the override, but only one block
 * in the fleet sets it, so the common path is detecting the dropdown by id.
 */
export function getOperationSubBlockId(config: CanvasSentenceConfig): string | null {
  const declared = config.canvasPresentation?.operationSubBlockId
  if (declared) return declared

  return config.subBlocks.some((subBlock) => subBlock.id === OPERATION_SUBBLOCK_ID)
    ? OPERATION_SUBBLOCK_ID
    : null
}

/** Picks the sentence declared for an operation, or the block's single default. */
function getCanvasSentence(
  config: CanvasSentenceConfig,
  operationValue: unknown
): CanvasSentence | null {
  const sentences = config.canvasPresentation?.sentences
  if (!sentences) return null

  /* `hasOwn`, not a bare index: an imported or copilot-authored workflow can
     hold any string here, and `byOperation['constructor']` would otherwise
     return a function that is truthy and then throws when iterated. */
  if (typeof operationValue === 'string' && sentences.byOperation) {
    if (Object.hasOwn(sentences.byOperation, operationValue)) {
      return sentences.byOperation[operationValue]
    }
  }

  return sentences.default ?? null
}

function toFieldIds(field: string | readonly string[]): readonly string[] {
  return typeof field === 'string' ? [field] : field
}

function pushText(segments: ResolvedSentenceSegment[], text: string | undefined): void {
  if (text) segments.push(text)
}

/**
 * Resolves a block's summary sentence for its current state.
 *
 * A core clause renders whether or not its field is filled — its chip shows the
 * value when set and the field's noun when not — so an untouched card reads as
 * a whole sentence rather than as nothing. Everything else renders only once
 * filled, which keeps a configured card as short as what it actually says.
 *
 * @param card - Which card is being painted. Trigger mode draws on a different
 *   subblock set and a different sentence entirely, so callers state it rather
 *   than the resolver inferring it from a config flag that cannot see the
 *   block's own `triggerMode` state.
 * @param isFieldFilled - Whether a subblock holds a displayable value. Drives
 *   which slots show a value chip.
 * @param getOnCardSubBlock - The subblock definition this operation actually
 *   puts on the card, or `null`. Returning the *definition* rather than a
 *   boolean is what lets a core slot show the right noun: ids are not unique —
 *   Dropbox declares `path` eleven times with titles from "Destination Path" to
 *   "Path to Delete" — so a caller that answers only yes/no leaves the resolver
 *   guessing, and it guessed first-declared-wins.
 */
export function resolveCanvasSentence(
  config: CanvasSentenceConfig,
  card: CardSelector,
  isFieldFilled: (subBlockId: string) => boolean,
  getOnCardSubBlock: (subBlockId: string) => SubBlockConfig | null
): ResolvedSentenceSegment[] | null {
  const sentence =
    card.mode === 'trigger'
      ? resolveTriggerSentence(config, card.triggerId, card.triggerName)
      : getCanvasSentence(config, card.operationValue)
  if (!sentence) return null

  const segments: ResolvedSentenceSegment[] = []

  for (const clause of sentence as readonly CanvasSentenceClause[]) {
    if (typeof clause === 'string') {
      segments.push(clause)
      continue
    }

    const isCore = clause.core === true

    /*
     * The first filled field wins; failing that a core clause takes the first
     * field merely on the card, whose noun holds the slot. A filled field this
     * operation does not show is not on the card, so it cannot supply a chip
     * either — hence one lookup deciding both.
     */
    let filled: SentenceSlot | null = null
    let onCard: SentenceSlot | null = null
    for (const subBlockId of toFieldIds(clause.field)) {
      const subBlock = getOnCardSubBlock(subBlockId)
      if (!subBlock) continue
      onCard ??= { subBlockId, subBlock }
      if (isFieldFilled(subBlockId)) {
        filled = { subBlockId, subBlock }
        break
      }
    }

    if (filled) {
      pushText(segments, clause.text)
      segments.push(
        isCore
          ? { subBlockId: filled.subBlockId, noun: resolveFieldNoun(filled.subBlock) }
          : { subBlockId: filled.subBlockId }
      )
      pushText(segments, clause.after)
      continue
    }

    /* An incidental clause is the detail a user has not reached yet; it drops so
       a configured card stays as short as what it actually says. */
    if (!isCore || !onCard) continue

    pushText(segments, clause.text)
    segments.push({ subBlockId: onCard.subBlockId, noun: resolveFieldNoun(onCard.subBlock) })
    pushText(segments, clause.after)
  }

  /*
   * Not the empty-card path. `check:canvas-sentences` drives this resolver over
   * every operation in both basic and advanced mode against the card's own
   * visibility filter, and nothing comes back empty — the two states it cannot
   * construct are a deployment-gated field (`showWhenEnvSet`, `hideWhenHosted`)
   * and an async reactive condition, which the rules deliberately treat as
   * undecidable rather than assume. `null` rather than `[]` degrades those to
   * the field rows; an empty array is truthy and would paint a blank card.
   */
  return segments.length > 0 ? segments : null
}

/**
 * What `getDisplayValue` reports for a field holding nothing.
 *
 * Not an empty string — `hasDisplayableRowValue` is literally defined as
 * `getDisplayValue(raw) !== '-'`, so this sentinel is the codebase's "unset".
 */
const EMPTY_VALUE_SENTINEL = '-'

/** Approximate character widths for the sentence line estimate (px). */
const SENTENCE_TEXT_CHAR_PX = 6.3
const SENTENCE_CHIP_CHAR_PX = 6.8
/** Inline chip horizontal padding + surrounding gap (px). */
const SENTENCE_CHIP_EXTRA_PX = 26
/** Chip text is truncated around this many characters by max-width. */
const SENTENCE_CHIP_MAX_CHARS = 24
/** `max-w-[160px]` on the chip itself, in `SubBlockRowView`'s `inline-value`. */
const SENTENCE_CHIP_MAX_PX = 160

/**
 * Estimates how many lines a sentence wraps to, for the card's height.
 *
 * Deliberately approximate — it sums one ribbon of text and divides by the
 * wrap width rather than packing words per line. Being off by a line only
 * changes reserved height, never where a handle anchors, and the card paints
 * its silhouette from its own measured DOM rather than from this number.
 *
 * @param wrapWidthPx - Usable width inside the card, less its padding.
 */
export function estimateSentenceLines(
  segments: ResolvedSentenceSegment[],
  getValueText: (subBlockId: string) => string,
  wrapWidthPx: number
): number {
  let widthPx = 0

  for (const segment of segments) {
    if (typeof segment === 'string') {
      widthPx += segment.length * SENTENCE_TEXT_CHAR_PX + 4
      continue
    }
    /* An empty core slot still paints a chip — its noun — so the estimate has to
       measure whichever of the two the card is actually showing. `getDisplayValue`
       reports an unset field as the `-` sentinel rather than an empty string, so
       testing truthiness here would measure every placeholder as one character. */
    const value = getValueText(segment.subBlockId)
    const chipText = value && value !== EMPTY_VALUE_SENTINEL ? value : (segment.noun ?? '')
    const valueLength = Math.min(chipText.length, SENTENCE_CHIP_MAX_CHARS)
    widthPx += Math.min(
      valueLength * SENTENCE_CHIP_CHAR_PX + SENTENCE_CHIP_EXTRA_PX,
      SENTENCE_CHIP_MAX_PX
    )
  }

  return Math.max(1, Math.ceil(widthPx / wrapWidthPx))
}
