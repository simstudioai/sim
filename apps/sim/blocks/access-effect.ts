import { MODEL_PROVIDER_ACCESS_IDS } from '@/blocks/model-provider-access'
import type { BlockConfig } from '@/blocks/types'
import { getToolMetadata } from '@/tools/metadata'
import type { ToolEffect } from '@/tools/types'

const MODEL_PROVIDER_ACCESS_ID_SET: ReadonlySet<string> = new Set(MODEL_PROVIDER_ACCESS_IDS)

/**
 * The effect of one `tools.access` id: a registered tool's declared effect; `read` for a model
 * provider, since a model call changes nothing outside Sim and a dry run sends it; `write` for any
 * other id, which declares nothing. A block that also runs tools its user chooses is a writer
 * whatever its access ids say.
 */
export function accessIdEffect(id: string): ToolEffect {
  return getToolMetadata(id)?.effect ?? (MODEL_PROVIDER_ACCESS_ID_SET.has(id) ? 'read' : 'write')
}

/**
 * A block's effect, the one rule every catalog reads: `write` when it runs tools its user chooses
 * (a `tool-input` field, as an Agent has) or any of its access ids writes ({@link accessIdEffect}),
 * else `read`. Undefined for a block with no tools at all.
 */
export function blockEffect(
  block: Pick<BlockConfig, 'tools' | 'subBlocks'>
): ToolEffect | undefined {
  const access = block.tools?.access ?? []
  const runsChosenTools = (block.subBlocks ?? []).some((subBlock) => subBlock.type === 'tool-input')
  if (access.length === 0) return runsChosenTools ? 'write' : undefined
  return !runsChosenTools && access.every((toolId) => accessIdEffect(toolId) === 'read')
    ? 'read'
    : 'write'
}
