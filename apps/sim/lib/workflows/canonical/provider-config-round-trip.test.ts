/**
 * @vitest-environment node
 *
 * The regression net for the phantom-redeploy bug class.
 *
 * Deploy materializes every declared `defaultValue` into `webhook.providerConfig`
 * (`getConfigValue`), and the editor reads that back into live state when a
 * trigger block's panel opens (`populateTriggerFieldsFromConfig`). The stored
 * block it writes into does not necessarily have those keys — a workflow saved
 * before a field was added has no entry for it at all.
 *
 * So for every registered trigger, the round trip
 *
 *     stored block -> providerConfig -> read back into stored block
 *
 * must be invisible to change detection. When it is not, opening a block's panel
 * flips the deploy button to "Update" for a change the user never made, and no
 * amount of redeploying clears it. That is what shipped in #6893, when two
 * defaulted switches were added to the generic webhook trigger.
 *
 * This asserts the property over the whole registry rather than per field, so
 * the NEXT defaulted field is caught here instead of in production.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { buildProviderConfig } from '@/lib/webhooks/deploy'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import { getAllBlocks } from '@/blocks'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'
import type { TriggerConfig } from '@/triggers/types'

const BLOCK_ID = 'trigger-block'

/**
 * Every way a trigger can actually be hosted, which is the unit that matters:
 * the canonical form resolves declared defaults from the BLOCK config, and a
 * dual-mode block (`slack`) hosts triggers whose ids are not block types.
 * Enumerating triggers alone would have tested a block type that never exists.
 */
function hostedTriggers(): Array<{ blockType: string; triggerId: string }> {
  const pairs: Array<{ blockType: string; triggerId: string }> = []

  for (const block of getAllBlocks()) {
    const ids = new Set<string>(block.triggers?.available ?? [])
    if (block.category === 'triggers' && isTriggerValid(block.type)) ids.add(block.type)

    for (const triggerId of ids) {
      if (isTriggerValid(triggerId)) pairs.push({ blockType: block.type, triggerId })
    }
  }

  return pairs
}

function configurableSubBlocks(trigger: TriggerConfig) {
  return trigger.subBlocks.filter(
    (subBlock) =>
      (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') &&
      !SYSTEM_SUBBLOCK_IDS.includes(subBlock.id)
  )
}

/**
 * A block as the database would hold it. `absent` models a workflow saved before
 * the field existed; `null` models one saved while it existed but untouched.
 * Both are legal spellings of "the user never set this".
 */
function storedBlock(
  blockType: string,
  trigger: TriggerConfig,
  spelling: 'absent' | 'null'
): BlockState {
  const subBlocks: Record<string, unknown> = {
    selectedTriggerId: { id: 'selectedTriggerId', type: 'short-input', value: trigger.id },
  }

  if (spelling === 'null') {
    for (const subBlock of configurableSubBlocks(trigger)) {
      subBlocks[subBlock.id] = { id: subBlock.id, type: subBlock.type, value: null }
    }
  }

  return {
    id: BLOCK_ID,
    type: blockType,
    name: trigger.name,
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
    enabled: true,
    horizontalHandles: true,
    triggerMode: true,
    data: {},
  } as unknown as BlockState
}

/**
 * A pure port of `populateTriggerFieldsFromConfig` composed with the structural
 * half of `mergeSubblockStateWithValues`: a written value lands on the block,
 * creating the entry when the structure had none (which is only allowed for a
 * non-null value).
 */
function readProviderConfigBack(
  block: BlockState,
  providerConfig: Record<string, unknown>,
  trigger: TriggerConfig
): BlockState {
  const subBlocks: Record<string, unknown> = { ...(block.subBlocks ?? {}) }

  for (const subBlock of configurableSubBlocks(trigger)) {
    const configValue = providerConfig[subBlock.id]
    if (configValue === undefined) continue

    const existing = subBlocks[subBlock.id] as { value?: unknown } | undefined
    const current = existing?.value
    if (current !== null && current !== undefined && current !== '') continue
    if (configValue === null) continue

    subBlocks[subBlock.id] = {
      id: subBlock.id,
      type: existing ? (existing as { type?: string }).type : 'short-input',
      value: configValue,
    }
  }

  return { ...block, subBlocks } as BlockState
}

function stateWith(block: BlockState): WorkflowState {
  return {
    blocks: { [BLOCK_ID]: block },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  } as unknown as WorkflowState
}

const pairs = hostedTriggers()

describe('deploy -> providerConfig -> read-back round trip', () => {
  it('covers every hosted trigger', () => {
    expect(pairs.length).toBeGreaterThan(50)
  })

  it.each(pairs.map((p) => [`${p.blockType} / ${p.triggerId}`, p] as const))(
    '%s is invisible to change detection',
    (_label, { blockType, triggerId }) => {
      const trigger = getTrigger(triggerId)

      for (const spelling of ['absent', 'null'] as const) {
        const stored = storedBlock(blockType, trigger, spelling)
        const { providerConfig } = buildProviderConfig(stored, triggerId, trigger)
        const afterFocus = readProviderConfigBack(stored, providerConfig, trigger)

        const summary = generateWorkflowDiffSummary(stateWith(afterFocus), stateWith(stored))
        const reported = summary.modifiedBlocks.flatMap((b) => b.changes.map((c) => c.field))

        expect(
          reported,
          `${blockType}/${triggerId} (${spelling}) reported a change the user never made`
        ).toEqual([])
      }
    }
  )
})
