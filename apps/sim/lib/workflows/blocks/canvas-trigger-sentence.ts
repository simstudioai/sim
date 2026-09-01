import type { BlockConfig, CanvasSentence } from '@/blocks/types'

/**
 * The sentence a card paints while it is in trigger mode.
 *
 * A trigger card says something categorically different from an action card: not
 * what the block does, but what starts the run. It also draws on a different
 * subblock set — trigger mode swaps them wholesale — so it gets its own
 * declaration slot rather than another `byOperation` key.
 *
 * Most of the 76 trigger-capable blocks need nothing declared. Their trigger
 * config is a webhook URL and a signing secret, which is plumbing rather than
 * meaning, and the thing actually worth reading is *which* event was picked —
 * already curated as the trigger's `name` in `apps/sim/triggers/`. So the
 * baseline is derived from that, and `triggerSentences` is for the blocks whose
 * configuration is itself the meaning (a schedule's interval, a mailbox's label).
 */

/** The dropdown a multi-trigger block uses to pick which event it listens for. */
const TRIGGER_PICKER_ID = 'selectedTriggerId'

type TriggerSentenceConfig = Pick<BlockConfig, 'canvasPresentation' | 'triggers' | 'subBlocks'>

/**
 * The trigger a card is configured for.
 *
 * Mirrors `getTriggerId` in `block-outputs.ts`: an explicit selection wins,
 * otherwise the block's first available trigger, which is what a freshly
 * dropped block runs. Validated against the block's own `available` list rather
 * than the trigger registry — importing that here would put it in the resolver's
 * load path, where it cycles with the block files that call `getTrigger()` at
 * module scope.
 */
export function resolveSelectedTriggerId(
  config: TriggerSentenceConfig,
  values: Record<string, unknown>
): string | null {
  const available = config.triggers?.available ?? []
  for (const key of ['selectedTriggerId', 'triggerId']) {
    const value = values[key]
    if (typeof value === 'string' && available.includes(value)) return value
  }
  return available[0] ?? null
}

/**
 * The declared trigger sentence, or one derived from the trigger's own name.
 *
 * Returns `null` only when the block has no trigger at all — a card with no
 * event to name has nothing to say.
 *
 * @param triggerName - The trigger's curated registry name. Supplied by the
 *   caller rather than looked up here, for the same load-order reason as above.
 */
export function resolveTriggerSentence(
  config: TriggerSentenceConfig,
  triggerId: string | null,
  triggerName: string | null
): CanvasSentence | null {
  const declared = config.canvasPresentation?.triggerSentences
  if (declared) {
    if (triggerId && declared.byTrigger && Object.hasOwn(declared.byTrigger, triggerId)) {
      return declared.byTrigger[triggerId]
    }
    if (declared.default) return declared.default
  }

  /*
   * Where the block offers a choice of event, that choice is a field like any
   * other — so it renders as a live chip and the card reads like an action card:
   * `Run on ⟨Pull Request Opened⟩`. The picker is seeded with the block's
   * default trigger, so the chip shows a real label from the moment it is
   * dropped, and it follows the user when they switch events.
   */
  if (config.subBlocks?.some((subBlock) => subBlock.id === TRIGGER_PICKER_ID)) {
    return ['Run on', { field: TRIGGER_PICKER_ID, core: true }]
  }

  if (!triggerName) return null

  /* A block with exactly one trigger has no picker and nothing to chip, so its
     event is literal copy — the registry name is already curated prose. */
  return [`Run on ${triggerName}`]
}
