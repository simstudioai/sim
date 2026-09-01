import type { CanonicalFieldSpec } from '@/lib/workflows/canonical/subblock-value'
import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

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
 * A type-keyed cache would keep serving a published block's old field defaults
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
 * a trigger switch defaulting to `false`. Only one of them governs the value
 * being compared, so the declaration matching the block's mode wins and mere
 * declaration order does not decide it. Taking the first declaration made the
 * trigger's default invisible, and the round-trip property test caught it on
 * seven blocks.
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
      defaultValue: subBlock.defaultValue,
      emptyIsValid: subBlock.emptyIsValid,
    })
  }

  return { fields }
}

/**
 * Resolves the declared field specs governing a block's stored values.
 *
 * Returns `undefined` for a type the registry does not know (a deleted custom
 * block, a state written by a newer version). Callers must treat that as "no
 * declared defaults", which degrades the canonical form to blank-collapsing
 * only — never to reporting a change it would otherwise have suppressed.
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
  return inTriggerMode ? variants.trigger : variants.action
}
