/**
 * What is active: a stored param the serializer sends to the executor, or one deploy reads into
 * the webhook provider config when the block acts as a trigger. Everything else is inactive:
 * stored, never executed, left out of source and restored from the stored workflow. Canonicalize,
 * print, materialize and the executable view all ask here, so they agree on what is active.
 */

import type { CanonicalBlock, SubBlockId } from '../model'
import { setOwn } from '../records'
import {
  type CanonicalIndex,
  type CanonicalModeOverrides,
  isCanonicalPair,
  isNonEmptyValue,
  resolveCanonicalMode,
} from './canonical-index'
import { evaluateCondition, recordLookup } from './conditions'
import { buildCanonicalIndexForSurface, isTriggerSurface, onSurface } from './surface'
import type { BlockCatalog, CatalogBlock, CatalogSubBlock } from './types'
import { catalogBlock, catalogTrigger } from './view'

/** Agent fields the serializer still forwards with no config, for its legacy migration. */
const LEGACY_AGENT_FIELDS = new Set(['systemPrompt', 'userPrompt', 'memories'])
/** A custom block's computed wiring; the serializer recomputes it and never forwards it. */
const CUSTOM_BLOCK_WIRING = new Set(['workflowId', 'inputMapping'])
/**
 * Trigger fields deploy never copies into the webhook provider config (`SYSTEM_SUBBLOCK_IDS`,
 * triggers/constants.ts). `triggerCredentials` is one of them but is read on its own as the
 * credential reference, so it is not listed.
 */
const DEPLOY_SKIPPED_IDS = new Set([
  'triggerInstructions',
  'webhookUrlDisplay',
  'samplePayload',
  'setupScript',
  'scheduleInfo',
])

export interface ActivityInputs {
  block: CatalogBlock
  blockType: string
  triggerMode: boolean
  advancedMode: boolean
  /** Raw stored values by subBlock id, with `__canonicalModes` as the serializer passes them. */
  values: Record<string, unknown>
  overrides: CanonicalModeOverrides | undefined
  index: CanonicalIndex
  /**
   * Ids deploy reads into the webhook provider config when the block acts as a trigger
   * ({@link deployReadIds}). Active whatever their visibility: deploy reads them without the
   * serializer's rules.
   */
  deployRead: ReadonlySet<SubBlockId>
}

function triggerExists(catalog: BlockCatalog, id: unknown): id is string {
  return typeof id === 'string' && catalogTrigger(catalog, id) !== undefined
}

/**
 * `resolveBlockTriggerId` (triggers/webhook-url.ts): a trigger block is its own trigger; a block in
 * trigger mode deploys as `selectedTriggerId`, else the stored `triggerId`, else the first trigger
 * its config makes available.
 */
function deployedTriggerId(
  catalog: BlockCatalog,
  block: CatalogBlock,
  blockType: string,
  triggerMode: boolean,
  values: Record<string, unknown>
): string | undefined {
  if (block.category === 'triggers' && triggerExists(catalog, blockType)) return blockType
  if (!triggerMode) return undefined
  if (triggerExists(catalog, values.selectedTriggerId)) return values.selectedTriggerId
  if (triggerExists(catalog, values.triggerId)) return values.triggerId
  const available = block.triggers?.enabled ? block.triggers.available[0] : undefined
  return triggerExists(catalog, available) ? available : undefined
}

/**
 * The second half of "active": what deploy reads from a block acting as a trigger
 * (`buildProviderConfig`, lib/webhooks/deploy.ts). It copies every trigger-mode field of the
 * deployed trigger's definition, visible or not, except the display-only system fields, and reads
 * `triggerCredentials` as the credential reference. Trigger-mode fields reach a run through the
 * webhook provider config, never through the block serializer.
 */
export function deployReadIds(
  catalog: BlockCatalog,
  block: CatalogBlock,
  blockType: string,
  triggerMode: boolean,
  values: Record<string, unknown>
): ReadonlySet<SubBlockId> {
  const triggerId = deployedTriggerId(catalog, block, blockType, triggerMode, values)
  const trigger = triggerId === undefined ? undefined : catalogTrigger(catalog, triggerId)
  if (!trigger) return new Set()
  const ids = new Set<SubBlockId>()
  for (const subBlock of trigger.subBlocks) {
    if (!isTriggerSurface(subBlock)) continue
    if (subBlock.id === 'triggerCredentials' || !DEPLOY_SKIPPED_IDS.has(subBlock.id)) {
      ids.add(subBlock.id)
    }
  }
  return ids
}

/**
 * A declaration's visibility condition over the block's values (`evaluateCondition`). What the
 * catalog's data cannot decide counts as satisfied, so the field is active.
 */
function conditionHolds(subBlock: CatalogSubBlock, values: Record<string, unknown>): boolean {
  return evaluateCondition(subBlock, recordLookup(values)) !== false
}

/**
 * `shouldSerializeSubBlock` (serializer/index.ts) over one catalog declaration. Env-gated hiding
 * (`hideWhenHosted` / `hideWhenEnvSet`) is deployment state the catalog does not carry, so it is
 * not applied.
 */
function serializes(subBlock: CatalogSubBlock, inputs: ActivityInputs): boolean {
  const { block, triggerMode, advancedMode, values, overrides, index } = inputs
  if (subBlock.context === 'tool-input') return false
  if (!onSurface(block, subBlock, triggerMode)) return false

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
      return matchesMode && conditionHolds(subBlock, values)
    }
    return conditionHolds(subBlock, values)
  }

  if (subBlock.mode === 'advanced' && !advancedMode) return isNonEmptyValue(values[subBlock.id])
  if (subBlock.mode === 'basic' && advancedMode) return false
  return conditionHolds(subBlock, values)
}

/**
 * Whether a stored param is inactive: stored, but neither forwarded by the serializer nor read by
 * deploy (`deployReadIds`) under the block's current values (s1 D3, quirks 1 and 10; build-spec decision 2). Mirrors the include rule in
 * `extractBlockParams` (serializer/index.ts:558-605): a param with declarations is active when
 * any declaration serializes; one with none is inactive except for the serializer's legacy
 * agent fields and for a custom block, whose stored fields may be its inputs.
 */
export function isInactive(id: SubBlockId, inputs: ActivityInputs): boolean {
  if (inputs.deployRead.has(id)) return false
  const isCustom = inputs.block.custom !== undefined
  if (isCustom && CUSTOM_BLOCK_WIRING.has(id)) return true
  const declarations = inputs.block.subBlocks.filter((subBlock) => subBlock.id === id)
  if (declarations.length === 0) {
    if (isCustom) return false
    return !(inputs.blockType === 'agent' && LEGACY_AGENT_FIELDS.has(id))
  }
  return !declarations.some((subBlock) => serializes(subBlock, inputs))
}

/**
 * The activity inputs of a canonical block: its CWM values, with its effective modes as explicit
 * overrides. The CWM records the mode the serializer resolves for every pair on the block's
 * surface (legacy `advancedMode` included), so an override reproduces it. Shared by the printer,
 * the executable view and materialize, so all three agree on what is inactive.
 */
export function canonicalActivityInputs(
  block: CanonicalBlock,
  catalogBlock: CatalogBlock,
  catalog: BlockCatalog
): ActivityInputs {
  const values: Record<string, unknown> = {}
  for (const [id, param] of Object.entries(block.params)) {
    setOwn(values, id, param.kind === 'value' ? param.value : param.tools)
  }
  const overrides: CanonicalModeOverrides = { ...block.modes }
  setOwn(values, '__canonicalModes', overrides)
  return {
    block: catalogBlock,
    blockType: block.type,
    triggerMode: block.triggerMode,
    advancedMode: block.advancedMode,
    values,
    overrides,
    index: buildCanonicalIndexForSurface(catalogBlock, block.triggerMode),
    deployRead: deployReadIds(catalog, catalogBlock, block.type, block.triggerMode, values),
  }
}

/**
 * The params of a catalog block that never reach execution under its current values: what source
 * leaves out and materialize restores from the stored workflow. A subflow container has none.
 */
export function executableInactiveParams(
  block: CanonicalBlock,
  catalog: BlockCatalog
): SubBlockId[] {
  const declared = catalogBlock(catalog, block.type)
  if (!declared || block.subflow) return []
  const inputs = canonicalActivityInputs(block, declared, catalog)
  return Object.keys(block.params).filter((id) => isInactive(id, inputs))
}
