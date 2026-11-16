/**
 * Builds one stored block for a corpus case from its registry config, the way the editor would
 * have persisted it: every declared subBlock present as `{ id, type, value }` (later declarations
 * of a duplicated id set the type, as `createBlockFromParams` does), visible fields filled by
 * type, hidden ones `null`, and `data.canonicalModes` explicit for every pair.
 */

import {
  evaluateSubBlockCondition,
  isCanonicalPair,
} from '@sim/workflow-code/catalog/canonical-index'
import type { SeededRandom } from '@/lib/workflows/code/corpus/random'
import {
  type FillContext,
  fillSubBlockValue,
  isWritableSubBlock,
} from '@/lib/workflows/code/corpus/values'
import {
  buildCanonicalIndexForSurface,
  buildDefaultCanonicalModes,
  isStandaloneAdvancedMode,
  isTriggerModeSubBlock,
  withCanonicalModes,
} from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { BlockState, SubBlockState } from '@/stores/workflows/workflow/types'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

export type PairMode = 'basic' | 'advanced'

interface BlockFixtureInput {
  config: BlockConfig
  id: string
  name: string
  rng: SeededRandom
  newId: () => string
  toolType: FillContext['toolType']
  /** The stored `triggerMode` flag. */
  triggerMode: boolean
  operation?: string
  triggerId?: string
  /** The effective member of every basic/advanced pair. */
  pairMode: PairMode
  /** The block-level advanced toggle; when on, standalone advanced fields are filled. */
  advancedMode: boolean
  /** Fill standalone advanced fields even with `advancedMode` off: they still serialize. */
  fillStandaloneAdvanced?: boolean
  parentId?: string
  position?: { x: number; y: number }
}

export interface BlockFixture {
  block: BlockState
  /** Subblock ids that received a corpus value, in declaration order. */
  filled: string[]
}

/** Whether a subBlock belongs to the surface (action or trigger) this block is stored on. */
export function isOnSurface(
  subBlock: SubBlockConfig,
  config: BlockConfig,
  triggerSurface: boolean
) {
  if (config.category === 'triggers') return true
  return triggerSurface === isTriggerModeSubBlock(subBlock)
}

export function isStandaloneAdvanced(subBlock: SubBlockConfig): boolean {
  return isStandaloneAdvancedMode(subBlock.mode) && !subBlock.canonicalParamId
}

/** Visible under `values`; a condition that throws counts as hidden. */
export function isVisible(subBlock: SubBlockConfig, values: Record<string, unknown>): boolean {
  try {
    return evaluateSubBlockCondition(subBlock.condition, values)
  } catch {
    return false
  }
}

export function buildBlockFixture(input: BlockFixtureInput): BlockFixture {
  const { config } = input
  const triggerSurface = input.triggerMode || config.category === 'triggers'
  const index = buildCanonicalIndexForSurface(config.subBlocks, triggerSurface)
  const canonicalModes = Object.fromEntries(
    Object.keys(buildDefaultCanonicalModes(config.subBlocks)).map((id) => [id, input.pairMode])
  )

  const values: Record<string, unknown> = {}
  if (input.operation !== undefined) values.operation = input.operation
  if (input.triggerId !== undefined) values.selectedTriggerId = input.triggerId

  const subBlocks: Record<string, SubBlockState> = {}
  const filled: string[] = []
  const ctx: FillContext = { rng: input.rng, values, newId: input.newId, toolType: input.toolType }

  for (const subBlock of config.subBlocks) {
    const existing = subBlocks[subBlock.id]
    if (existing) {
      existing.type = subBlock.type
      if (existing.value !== null) continue
    }

    const value = valueFor(subBlock, input, index, triggerSurface, canonicalModes, ctx)
    subBlocks[subBlock.id] = {
      id: subBlock.id,
      type: subBlock.type,
      value: value as SubBlockState['value'],
    }
    if (value !== null && value !== undefined) {
      values[subBlock.id] = value
      if (!filled.includes(subBlock.id)) filled.push(subBlock.id)
    }
  }

  const data: NonNullable<BlockState['data']> = {}
  if (input.parentId) {
    data.parentId = input.parentId
    data.extent = 'parent'
  }
  if (Object.keys(canonicalModes).length > 0) data.canonicalModes = canonicalModes

  return {
    block: {
      id: input.id,
      type: config.type,
      name: input.name,
      position: input.position ?? { x: 0, y: 0 },
      subBlocks,
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      advancedMode: input.advancedMode,
      triggerMode: input.triggerMode,
      height: 0,
      data,
      locked: false,
    },
    filled,
  }
}

function valueFor(
  subBlock: SubBlockConfig,
  input: BlockFixtureInput,
  index: ReturnType<typeof buildCanonicalIndexForSurface>,
  triggerSurface: boolean,
  canonicalModes: Record<string, PairMode>,
  ctx: FillContext
): unknown {
  if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(subBlock.id)) return null
  if (!isOnSurface(subBlock, input.config, triggerSurface)) return null
  if (subBlock.id === 'operation' && input.operation !== undefined) return input.operation
  if (subBlock.id === 'selectedTriggerId' && input.triggerId !== undefined) return input.triggerId
  if (!isVisible(subBlock, withCanonicalModes(ctx.values, canonicalModes))) return null

  const canonicalId = index.canonicalIdBySubBlockId[subBlock.id]
  const group = canonicalId ? index.groupsById[canonicalId] : undefined
  if (group && isCanonicalPair(group)) {
    const isBasic = group.basicId === subBlock.id
    if (input.pairMode === 'basic' ? !isBasic : isBasic) return null
  } else if (isStandaloneAdvanced(subBlock)) {
    if (!input.advancedMode && !input.fillStandaloneAdvanced) return null
  }

  if (!isWritableSubBlock(subBlock) || subBlock.hidden) {
    return subBlock.defaultValue === undefined ? null : structuredClone(subBlock.defaultValue)
  }
  return fillSubBlockValue(subBlock, ctx)
}
