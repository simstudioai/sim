import {
  buildCanonicalIndexForSurface,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isSubBlockFeatureEnabled,
  isSubBlockHidden,
  isSubBlockVisibleForMode,
  isToolInputOnlySubBlock,
  isTriggerModeSubBlock,
} from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

/**
 * Which subblocks a block's card puts on screen, value or no value.
 *
 * One definition, because two of them is what broke this feature: the card
 * filtered on mode, feature flags and conditions while the sentence validator
 * modelled only conditions, so 35 sentences were certified against a card that
 * shows strictly more fields than any real one. Anything that needs to know
 * what is on a card — the card itself, the sentence resolver's callers, the CI
 * check — asks here.
 *
 * Excludes the value test on purpose: a sentence's core slots render whether or
 * not their field is filled, so they need this set, while the field rows below
 * need the value-bearing subset of it.
 */
export interface CardFieldsOptions {
  /** Block-level advanced toggle. A fresh card is basic. */
  advanced: boolean
  /** Current subblock values, for conditions and canonical mode resolution. */
  values: Record<string, unknown>
  canonicalModeOverrides?: CanonicalModeOverrides
  /**
   * The card is showing the block as a trigger, which swaps the subblock set — and with it the
   * canonical index, which this derives rather than accepts. A caller that supplied its own could
   * hand in one built for the other surface, and every caller did: a mixed action/trigger block's
   * trigger fields all collapse into the action pairs they share a `canonicalParamId` with, so
   * `isSubBlockVisibleForMode` matched none of them and dropped Airtable's Base ID and Table ID,
   * Webflow's Site and Collection, and eight blocks' trigger Credentials off the card entirely.
   */
  triggerMode?: boolean
  /** Ids an async reactive condition has hidden; runtime-only, empty in checks. */
  hiddenIds?: ReadonlySet<string>
  /** The operation dropdown, when it supplies the card title instead of a row. */
  titleOperationSubBlockId?: string | null
}

type CardFieldsConfig = Pick<BlockConfig, 'subBlocks' | 'category' | 'triggers'>

/**
 * The subblock values a freshly-created block holds.
 *
 * Mirrors `prepareBlockState` in `stores/workflows/utils.ts`: a generator wins,
 * then `defaultValue`, then nothing. Conditions are evaluated against the whole
 * seeded map, not just the operation — Response's `builderData` is gated on
 * `dataMode`, which defaults to `structured`, so seeding only the operation
 * makes that field look hidden and its sentence look broken.
 */
export function getSeededSubBlockValues(config: CardFieldsConfig): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const subBlock of config.subBlocks) {
    if (typeof subBlock.value === 'function') {
      try {
        values[subBlock.id] = subBlock.value({})
      } catch {
        values[subBlock.id] = null
      }
    } else if (subBlock.defaultValue !== undefined) {
      values[subBlock.id] = subBlock.defaultValue
    } else {
      values[subBlock.id] = null
    }
  }
  return values
}

export function getCardSubBlocks(
  config: CardFieldsConfig,
  options: CardFieldsOptions
): SubBlockConfig[] {
  const {
    advanced,
    values,
    canonicalModeOverrides,
    triggerMode = false,
    hiddenIds,
    titleOperationSubBlockId,
  } = options

  const canonicalIndex = buildCanonicalIndexForSurface(config.subBlocks, triggerMode)
  const isPureTriggerBlock = Boolean(config.triggers?.enabled && config.category === 'triggers')

  return config.subBlocks.filter((subBlock) => {
    if (subBlock.hidden || subBlock.hideFromPreview) return false
    if (hiddenIds?.has(subBlock.id)) return false
    if (!isSubBlockFeatureEnabled(subBlock)) return false

    /* Configures the block as an agent tool; it has no meaning on the canvas. */
    if (isToolInputOnlySubBlock(subBlock)) return false
    if (isSubBlockHidden(subBlock)) return false

    if (triggerMode) {
      const isValidTriggerSubBlock = isPureTriggerBlock
        ? isTriggerModeSubBlock(subBlock) || !subBlock.mode
        : isTriggerModeSubBlock(subBlock)
      if (!isValidTriggerSubBlock) return false
    } else if (isTriggerModeSubBlock(subBlock)) {
      return false
    }

    if (
      !isSubBlockVisibleForMode(subBlock, advanced, canonicalIndex, values, canonicalModeOverrides)
    ) {
      return false
    }

    if (subBlock.condition && !evaluateSubBlockCondition(subBlock.condition, values)) return false

    /* The operation is the card's heading here, so it is not also a field. */
    if (titleOperationSubBlockId && subBlock.id === titleOperationSubBlockId) return false

    return true
  })
}
