/**
 * What is active: a stored param the serializer sends to the executor, or one deploy reads into
 * the webhook provider config when the block acts as a trigger. Everything else is inactive:
 * stored, never executed, left out of source and restored from the stored workflow. Canonicalize,
 * print, materialize and the executable view all ask here, so they agree on what is active.
 */

import {
  CUSTOM_BLOCK_RESERVED_PARAMS,
  LEGACY_AGENT_FIELDS,
  SYSTEM_SUBBLOCK_IDS,
} from '@sim/workflow-types/blocks'
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
import { isTriggerSurface, onSurface, serializedCanonicalIndex } from './surface'
import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBuilder,
  CatalogOutput,
  CatalogSubBlock,
} from './types'
import { catalogBlock, catalogTrigger, declarationsOf } from './view'

/** A custom block's computed wiring; the serializer recomputes it and never forwards it. */
const CUSTOM_BLOCK_WIRING = new Set(['workflowId', 'inputMapping'])

/**
 * `customBlockHasDeclaredInputs` (serializer/index.ts): a custom block that declares an input
 * drops every stored field it does not declare, as a deleted input. Only a schema-agnostic one
 * (legacy, no curated inputs) forwards them all.
 */
function declaresCustomInputs(block: CatalogBlock): boolean {
  return block.subBlocks.some((subBlock) => !CUSTOM_BLOCK_RESERVED_PARAMS.has(subBlock.id))
}

/**
 * Trigger fields deploy never copies into the webhook provider config, except `triggerCredentials`,
 * which it reads on its own as the credential reference.
 */
const TRIGGER_SYSTEM_IDS: ReadonlySet<string> = new Set(SYSTEM_SUBBLOCK_IDS)

/** What decides whether a block's stored params are active (`isInactive`). */
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
  values: Readonly<Record<string, unknown>>
): string | undefined {
  if (block.category === 'triggers' && triggerExists(catalog, blockType)) return blockType
  if (!triggerMode) return undefined
  if (triggerExists(catalog, values.selectedTriggerId)) return values.selectedTriggerId
  if (triggerExists(catalog, values.triggerId)) return values.triggerId
  const available = block.triggers?.enabled ? block.triggers.available[0] : undefined
  return triggerExists(catalog, available) ? available : undefined
}

/**
 * The outputs a block exposes to references: a block acting as a trigger runs as the trigger it
 * deploys as ({@link deployedTriggerId}) and emits that trigger's payload in place of its own
 * outputs; any other block exposes its own. This is the runtime's rule: `getBlockOutputs`
 * (lib/workflows/blocks/outputs.ts) returns the resolved trigger's outputs instead of the block's
 * for a block in trigger mode, and `TriggerBlockHandler` (executor/handlers/trigger/handler.ts)
 * returns the trigger's payload as the block's output. A trigger block (`category: 'triggers'`)
 * only ever runs as a trigger, so it resolves its trigger as in trigger mode whatever its flag
 * says (IMAP's `imap` block runs as `imap_poller`). `values` are the block's stored values, or a
 * builder's pins when only the builder is known.
 */
export function blockOutputSchemas(
  catalog: BlockCatalog,
  block: CatalogBlock,
  options: { triggerMode: boolean; values: Readonly<Record<string, unknown>> }
): Record<string, CatalogOutput> {
  const triggerMode = options.triggerMode || block.category === 'triggers'
  const triggerId = deployedTriggerId(catalog, block, block.type, triggerMode, options.values)
  const trigger = triggerId === undefined ? undefined : catalogTrigger(catalog, triggerId)
  return trigger ? trigger.outputs : block.outputs
}

/**
 * The outputs a block declared through `builder` exposes ({@link blockOutputSchemas}) when its
 * source sets no trigger of its own: a trigger-mode builder runs as the trigger it pins, else as
 * its block's first. Compile checks output paths and SDK codegen types a builder's outputs by
 * this one call, so a path compile accepts is one the SDK types.
 */
export function builderOutputSchemas(
  catalog: BlockCatalog,
  block: CatalogBlock,
  builder: CatalogBuilder | undefined
): Record<string, CatalogOutput> {
  return blockOutputSchemas(catalog, block, {
    triggerMode: builder?.triggerMode === true,
    values: builder?.fixed ?? {},
  })
}

/**
 * The second half of "active": what deploy reads from a block acting as a trigger
 * (`buildProviderConfig`, lib/webhooks/deploy.ts). It copies every trigger-mode field of the
 * deployed trigger's definition, visible or not, except the display-only system fields, and reads
 * `triggerCredentials` as the credential reference. Trigger-mode fields reach a run through the
 * webhook provider config, never through the block serializer.
 */
function deployReadIds(
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
    if (subBlock.id === 'triggerCredentials' || !TRIGGER_SYSTEM_IDS.has(subBlock.id)) {
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
 * deploy (`deployReadIds`) under the block's current values. Mirrors the include rule in
 * `extractBlockParams`: a param with declarations is active when
 * any declaration serializes; one with none is inactive except for the serializer's legacy
 * agent fields and for a schema-agnostic custom block, whose stored fields are its inputs.
 */
export function isInactive(id: SubBlockId, inputs: ActivityInputs): boolean {
  if (inputs.deployRead.has(id)) return false
  const isCustom = inputs.block.custom !== undefined
  if (isCustom && CUSTOM_BLOCK_WIRING.has(id)) return true
  const declarations = declarationsOf(inputs.block, id)
  if (declarations.length === 0) {
    if (isCustom) return declaresCustomInputs(inputs.block)
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
  declared: CatalogBlock,
  catalog: BlockCatalog
): ActivityInputs {
  const values: Record<string, unknown> = {}
  for (const [id, param] of Object.entries(block.params)) {
    setOwn(values, id, param.kind === 'value' ? param.value : param.tools)
  }
  const overrides: CanonicalModeOverrides = { ...block.modes }
  setOwn(values, '__canonicalModes', overrides)
  return {
    block: declared,
    blockType: block.type,
    triggerMode: block.triggerMode,
    advancedMode: block.advancedMode,
    values,
    overrides,
    index: serializedCanonicalIndex(declared, block.triggerMode),
    deployRead: deployReadIds(catalog, declared, block.type, block.triggerMode, values),
  }
}

/**
 * `inputs` with the stored value of `id` replaced by `value`: what {@link canonicalActivityInputs}
 * returns for the block holding that value, without rebuilding what the value cannot change. The
 * canonical index depends only on the block and its surface; the ids deploy reads change only
 * with the trigger it deploys as.
 */
export function withStoredValue(
  catalog: BlockCatalog,
  inputs: ActivityInputs,
  id: SubBlockId,
  value: unknown
): ActivityInputs {
  const values: Record<string, unknown> = { ...inputs.values }
  setOwn(values, id, value)
  const movesTrigger = id === 'selectedTriggerId' || id === 'triggerId'
  return {
    ...inputs,
    values,
    deployRead: movesTrigger
      ? deployReadIds(catalog, inputs.block, inputs.blockType, inputs.triggerMode, values)
      : inputs.deployRead,
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
