import type { CanonicalFieldSpec } from '@/lib/workflows/canonical/subblock-value'
import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { getTrigger } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'
import { resolveBlockTriggerId } from '@/triggers/webhook-url'

/** The declared shape of one block type, indexed for O(1) lookup per subblock. */
export interface CanonicalBlockSpec {
  fields: ReadonlyMap<string, CanonicalFieldSpec>
}

interface BlockSpecVariants {
  /** Resolved for a block rendering its action fields. */
  action: CanonicalBlockSpec
  /** Resolved for a block in trigger mode. */
  trigger: CanonicalBlockSpec
}

/**
 * Keyed on the config's identity rather than its block type, because `getBlock`
 * falls back to the custom-block overlay, whose configs are replaced at runtime.
 * A type-keyed cache would keep serving a published block's old field shapes
 * after an update; keying on identity re-derives when the object is swapped and
 * lets the old entry be collected. Built-in configs are module-scope singletons,
 * so they resolve to one stable entry for the life of the process.
 */
const variantsByConfig = new WeakMap<BlockConfig, BlockSpecVariants>()

function isTriggerDeclaration(subBlock: SubBlockConfig): boolean {
  return subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'
}

/**
 * Builds one variant's field index.
 *
 * A subblock id can be declared twice on the same block, once for its action
 * form and once for its trigger form — Gmail declares `includeAttachments` as an
 * unconditioned action switch and, via the spread of its poller's subblocks, as
 * a trigger switch. The declaration matching the block's mode governs shaping;
 * deployment defaults are resolved separately from the selected trigger.
 */
function buildVariant(config: BlockConfig, preferTrigger: boolean): CanonicalBlockSpec {
  const fields = new Map<string, CanonicalFieldSpec>()
  const matchedPreferredMode = new Set<string>()

  for (const subBlock of config.subBlocks ?? []) {
    const matches = isTriggerDeclaration(subBlock) === preferTrigger

    if (fields.has(subBlock.id)) {
      /* First declaration wins, unless it lost on mode and this one wins on mode. */
      if (!matches || matchedPreferredMode.has(subBlock.id)) continue
    }

    if (matches) matchedPreferredMode.add(subBlock.id)
    fields.set(subBlock.id, {
      type: subBlock.type,
      emptyIsValid: subBlock.emptyIsValid,
    })
  }

  return { fields }
}

/**
 * Resolves the declared field specs governing a block's stored values.
 *
 * Only the selected trigger's deployment fields carry implicit defaults:
 * `buildProviderConfig` substitutes them when a field is unset. Action defaults
 * initialize editor values but are not substituted by the serializer or executor.
 * Unknown block types have no declared spec.
 */
export function resolveCanonicalBlockSpec(block: BlockState): CanonicalBlockSpec | undefined {
  const config = getBlock(block.type)
  if (!config) return undefined

  let variants = variantsByConfig.get(config)
  if (!variants) {
    variants = {
      action: buildVariant(config, false),
      trigger: buildVariant(config, true),
    }
    variantsByConfig.set(config, variants)
  }

  /*
   * `category === 'triggers'` covers pure trigger blocks, whose fields are all
   * trigger-mode without the block carrying the flag.
   */
  const inTriggerMode = block.triggerMode === true || config.category === 'triggers'
  const variant = inTriggerMode ? variants.trigger : variants.action
  const triggerId = resolveBlockTriggerId(block)
  if (!triggerId) return variant

  const fields = new Map(variant.fields)
  for (const subBlock of getTrigger(triggerId).subBlocks) {
    if (!isTriggerDeclaration(subBlock) || SYSTEM_SUBBLOCK_IDS.includes(subBlock.id)) continue

    fields.set(subBlock.id, {
      type: subBlock.type,
      defaultValue: subBlock.defaultValue,
      emptyIsValid: subBlock.emptyIsValid,
    })
  }

  return { fields }
}
