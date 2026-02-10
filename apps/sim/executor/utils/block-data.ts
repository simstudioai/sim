import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { isTriggerBehavior, normalizeName } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { OutputSchema } from '@/executor/utils/block-reference'
import {
  extractBaseBlockId,
  extractBranchIndex,
  isBranchNodeId,
} from '@/executor/utils/subflow-utils'
import type { SerializedBlock } from '@/serializer/types'

export interface BlockDataCollection {
  blockData: Record<string, unknown>
  blockNameMapping: Record<string, string>
  blockOutputSchemas: Record<string, OutputSchema>
}

interface SubBlockWithValue {
  value?: unknown
}

function paramsToSubBlocks(
  params: Record<string, unknown> | undefined
): Record<string, SubBlockWithValue> {
  if (!params) return {}

  const subBlocks: Record<string, SubBlockWithValue> = {}
  for (const [key, value] of Object.entries(params)) {
    subBlocks[key] = { value }
  }
  return subBlocks
}

function getRegistrySchema(block: SerializedBlock): OutputSchema | undefined {
  const blockType = block.metadata?.id
  if (!blockType) return undefined

  const subBlocks = paramsToSubBlocks(block.config?.params)
  const triggerMode = isTriggerBehavior(block)
  const outputs = getEffectiveBlockOutputs(blockType, subBlocks, {
    triggerMode,
    preferToolOutputs: !triggerMode,
    includeHidden: true,
  }) as OutputSchema

  if (!outputs || Object.keys(outputs).length === 0) {
    return undefined
  }
  return outputs
}

export function getBlockSchema(block: SerializedBlock): OutputSchema | undefined {
  return getRegistrySchema(block)
}

export function collectBlockData(
  ctx: ExecutionContext,
  currentNodeId?: string
): BlockDataCollection {
  const blockData: Record<string, unknown> = {}
  const blockNameMapping: Record<string, string> = {}
  const blockOutputSchemas: Record<string, OutputSchema> = {}

  const branchIndex =
    currentNodeId && isBranchNodeId(currentNodeId) ? extractBranchIndex(currentNodeId) : null

  for (const [id, state] of ctx.blockStates.entries()) {
    if (state.output !== undefined) {
      blockData[id] = state.output

      if (branchIndex !== null && isBranchNodeId(id)) {
        const stateBranchIndex = extractBranchIndex(id)
        if (stateBranchIndex === branchIndex) {
          const baseId = extractBaseBlockId(id)
          if (blockData[baseId] === undefined) {
            blockData[baseId] = state.output
          }
        }
      }
    }
  }

  const workflowBlocks = ctx.workflow?.blocks ?? []
  for (const block of workflowBlocks) {
    const id = block.id

    if (block.metadata?.name) {
      blockNameMapping[normalizeName(block.metadata.name)] = id
    }

    const schema = getBlockSchema(block)
    if (schema && Object.keys(schema).length > 0) {
      blockOutputSchemas[id] = schema
    }
  }

  return { blockData, blockNameMapping, blockOutputSchemas }
}
