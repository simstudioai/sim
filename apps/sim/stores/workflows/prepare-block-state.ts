/**
 * Seeds a new block's state from its registry config.
 *
 * Split out of `stores/workflows/utils.ts` because this is the only function there
 * that needs the block registry and the generated tool-outputs artifact
 * (`getBlock`, `getEffectiveBlockOutputs`). `utils.ts` is reached by the persistent
 * workspace shell through the workflow list hooks, so housing this here kept
 * `tools/generated/tool-outputs.ts` (~476 KB gzip) on the cold path of every
 * workspace route for a function only the canvas drop handler calls.
 */

import type { SeedValueGate } from '@/lib/permission-groups/operation-access'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { createDefaultInputFormatField } from '@/lib/workflows/input-format'
import { buildDefaultCanonicalModes } from '@/lib/workflows/subblocks/visibility'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { getBlock } from '@/blocks'
import type { BlockState, Position, SubBlockState } from '@/stores/workflows/workflow/types'

export interface PrepareBlockStateOptions {
  id: string
  type: string
  name: string
  position: Position
  data?: Record<string, unknown>
  parentId?: string
  extent?: 'parent'
  triggerMode?: boolean
  /**
   * Vetoes a declared default that the creator's permission group denies —
   * today the `operation` and `model` fields, both of which blocks pre-fill.
   *
   * A vetoed field is seeded with nothing rather than a substitute. The editor's
   * own permission-aware pickers already resolve the right replacement (first
   * allowed operation; preferred-then-first allowed model) and they only fill a
   * field that is empty, so leaving it empty hands the choice to the one place
   * that knows how to make it. Substituting here instead would also drift from
   * `getDefaultBlockName`, which names the block after its *declared* default.
   *
   * Omit it entirely only where permission gating does not apply, in which case
   * declared defaults are seeded unchanged. A caller that cannot yet answer —
   * config still loading — vetoes rather than omitting, since a value written
   * here is never revisited.
   */
  isSeededValueAllowed?: SeedValueGate
}

/**
 * Prepares a BlockState object from block type and configuration.
 * Generates subBlocks and outputs from the block registry.
 */
export function prepareBlockState(options: PrepareBlockStateOptions): BlockState {
  const {
    id,
    type,
    name,
    position,
    data,
    parentId,
    extent,
    triggerMode = false,
    isSeededValueAllowed,
  } = options

  const blockConfig = getBlock(type)

  const blockData: Record<string, unknown> = { ...(data || {}) }
  if (parentId) blockData.parentId = parentId
  if (extent) blockData.extent = extent

  if (!blockConfig) {
    return {
      id,
      type,
      name,
      position,
      data: blockData,
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      advancedMode: false,
      triggerMode,
      height: 0,
    }
  }

  const subBlocks: Record<string, SubBlockState> = {}

  if (blockConfig.subBlocks) {
    blockConfig.subBlocks.forEach((subBlock) => {
      let initialValue: unknown = null

      if (typeof subBlock.value === 'function') {
        try {
          initialValue = subBlock.value({})
        } catch {
          initialValue = null
        }
      } else if (subBlock.defaultValue !== undefined) {
        initialValue = subBlock.defaultValue
      } else if (subBlock.type === 'input-format' || subBlock.type === 'response-format') {
        initialValue = [createDefaultInputFormatField()]
      } else if (subBlock.type === 'table') {
        initialValue = []
      }

      if (
        isSeededValueAllowed &&
        typeof initialValue === 'string' &&
        initialValue !== '' &&
        !isSeededValueAllowed(subBlock.id, initialValue)
      ) {
        initialValue = null
      }

      subBlocks[subBlock.id] = {
        id: subBlock.id,
        type: subBlock.type,
        value: initialValue as SubBlockState['value'],
      }
    })
  }

  const isTriggerCapable = hasTriggerCapability(blockConfig)
  const effectiveTriggerMode = Boolean(triggerMode && isTriggerCapable)
  const outputs = getEffectiveBlockOutputs(type, subBlocks, {
    triggerMode: effectiveTriggerMode,
    preferToolOutputs: !effectiveTriggerMode,
  })

  if (blockConfig.subBlocks) {
    const canonicalModes = buildDefaultCanonicalModes(blockConfig.subBlocks)
    if (Object.keys(canonicalModes).length > 0) {
      blockData.canonicalModes = canonicalModes
    }
  }

  return {
    id,
    type,
    name,
    position,
    data: blockData,
    subBlocks,
    outputs,
    enabled: true,
    horizontalHandles: true,
    advancedMode: false,
    triggerMode,
    height: 0,
    locked: false,
  }
}
