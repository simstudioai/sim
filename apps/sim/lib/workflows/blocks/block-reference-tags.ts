import { getEffectiveBlockOutputPaths } from '@/lib/workflows/blocks/block-outputs'
import { hasTriggerCapability } from '@/lib/workflows/triggers/trigger-utils'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers/triggers'
import { getBlock } from '@/blocks'
import { normalizeName } from '@/executor/constants'

interface ReferenceableBlock {
  id: string
  type: string
  name?: string
  triggerMode?: boolean
  subBlocks?: Record<string, { value?: unknown }>
}

interface GetBlockReferenceTagsOptions {
  block: ReferenceableBlock
  currentBlockId?: string
  subBlocks?: Record<string, { value?: unknown }>
}

/**
 * Returns the exact reference tags shown in the workflow tag dropdown for a block.
 */
export function getBlockReferenceTags({
  block,
  currentBlockId,
  subBlocks,
}: GetBlockReferenceTagsOptions): string[] {
  const blockName = block.name || block.type
  const normalizedBlockName = normalizeName(blockName)
  const mergedSubBlocks = subBlocks ?? block.subBlocks

  if (block.type === 'variables') {
    const variablesValue = mergedSubBlocks?.variables?.value
    if (Array.isArray(variablesValue) && variablesValue.length > 0) {
      const validAssignments = variablesValue.filter((assignment: { variableName?: string }) =>
        assignment?.variableName?.trim()
      )
      if (validAssignments.length > 0) {
        return validAssignments.map(
          (assignment: { variableName: string }) =>
            `${normalizedBlockName}.${assignment.variableName.trim()}`
        )
      }
    }

    return [normalizedBlockName]
  }

  const blockConfig = getBlock(block.type)
  if (!blockConfig) {
    return []
  }

  const isTriggerCapable = hasTriggerCapability(blockConfig)
  const effectiveTriggerMode = Boolean(block.triggerMode && isTriggerCapable)
  const outputPaths = getEffectiveBlockOutputPaths(block.type, mergedSubBlocks, {
    triggerMode: effectiveTriggerMode,
    preferToolOutputs: !effectiveTriggerMode,
  })
  const allTags = outputPaths.map((path) => `${normalizedBlockName}.${path}`)

  let blockTags: string[]
  if (block.type === 'human_in_the_loop' && block.id === currentBlockId) {
    blockTags = allTags.filter((tag) => tag.endsWith('.url') || tag.endsWith('.resumeEndpoint'))
  } else if (allTags.length === 0) {
    blockTags = [normalizedBlockName]
  } else {
    blockTags = allTags
  }

  if (!blockTags.includes(normalizedBlockName)) {
    blockTags = [normalizedBlockName, ...blockTags]
  }

  const shouldShowRootTag =
    block.type === TRIGGER_TYPES.GENERIC_WEBHOOK || block.type === 'start_trigger'
  if (!shouldShowRootTag) {
    blockTags = blockTags.filter((tag) => tag !== normalizedBlockName)
  }

  return blockTags
}
