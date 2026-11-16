import {
  type CanonicalIndex,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isCanonicalPair,
  isNonEmptyValue,
  resolveCanonicalMode,
} from '../catalog/canonical-index'
import type { CatalogBlock, CatalogSubBlock } from '../catalog/types'
import type { SubBlockId } from '../model'

/** Agent fields the serializer still forwards with no config, for its legacy migration. */
const LEGACY_AGENT_FIELDS = new Set(['systemPrompt', 'userPrompt', 'memories'])
/** A custom block's computed wiring; the serializer recomputes it and never forwards it. */
const CUSTOM_BLOCK_WIRING = new Set(['workflowId', 'inputMapping'])

export interface ActivityInputs {
  block: CatalogBlock
  blockType: string
  triggerMode: boolean
  advancedMode: boolean
  /** Raw stored values by subBlock id, with `__canonicalModes` as the serializer passes them. */
  values: Record<string, unknown>
  overrides: CanonicalModeOverrides | undefined
  index: CanonicalIndex
}

/**
 * `shouldSerializeSubBlock` (serializer/index.ts:55-108) over one catalog declaration.
 * Env-gated hiding (`hideWhenHosted` / `hideWhenEnvSet`) is deployment state the catalog does not
 * carry, so it is not applied. An opaque condition counts as satisfied (s1 canonicalize step 9).
 */
function serializes(subBlock: CatalogSubBlock, inputs: ActivityInputs): boolean {
  const { block, triggerMode, advancedMode, values, overrides, index } = inputs
  if (subBlock.context === 'tool-input') return false

  const isTriggerCategory = block.category === 'triggers'
  if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') {
    if (!triggerMode && !isTriggerCategory) return false
  } else if (triggerMode && !isTriggerCategory) {
    return false
  }

  const canonicalId = index.canonicalIdBySubBlockId[subBlock.id]
  if (canonicalId) {
    const group = index.groupsById[canonicalId]
    if (group && isCanonicalPair(group)) {
      const mode =
        overrides?.[group.canonicalId] != null || !advancedMode
          ? resolveCanonicalMode(group, values, overrides)
          : 'advanced'
      const matchesMode =
        mode === 'advanced'
          ? group.advancedIds.includes(subBlock.id)
          : group.basicId === subBlock.id
      return matchesMode && evaluateSubBlockCondition(subBlock.condition, values)
    }
    return evaluateSubBlockCondition(subBlock.condition, values)
  }

  if (subBlock.mode === 'advanced' && !advancedMode) return isNonEmptyValue(values[subBlock.id])
  if (subBlock.mode === 'basic' && advancedMode) return false
  return evaluateSubBlockCondition(subBlock.condition, values)
}

/**
 * Whether a stored param is inactive: stored, but not forwarded to execution under the block's
 * current values (s1 D3, quirks 1 and 10; build-spec decision 2). Mirrors the include rule in
 * `extractBlockParams` (serializer/index.ts:558-605): a param with declarations is active when
 * any declaration serializes; one with none is inactive except for the serializer's legacy
 * agent fields and for a custom block, whose stored fields may be its inputs.
 */
export function isInactive(id: SubBlockId, inputs: ActivityInputs): boolean {
  const isCustom = inputs.block.custom !== undefined
  if (isCustom && CUSTOM_BLOCK_WIRING.has(id)) return true
  const declarations = inputs.block.subBlocks.filter((subBlock) => subBlock.id === id)
  if (declarations.length === 0) {
    if (isCustom) return false
    return !(inputs.blockType === 'agent' && LEGACY_AGENT_FIELDS.has(id))
  }
  return !declarations.some((subBlock) => serializes(subBlock, inputs))
}
