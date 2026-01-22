import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { normalizeName } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { OutputSchema } from '@/executor/utils/block-reference'

export interface BlockDataCollection {
  blockData: Record<string, unknown>
  blockNameMapping: Record<string, string>
  blockOutputSchemas: Record<string, OutputSchema>
}

export function collectBlockData(ctx: ExecutionContext): BlockDataCollection {
  const blockData: Record<string, unknown> = {}
  const blockNameMapping: Record<string, string> = {}
  const blockOutputSchemas: Record<string, OutputSchema> = {}

  for (const [id, state] of ctx.blockStates.entries()) {
    if (state.output !== undefined) {
      blockData[id] = state.output
    }

    const workflowBlock = ctx.workflow?.blocks?.find((b) => b.id === id)
    if (!workflowBlock) continue

    if (workflowBlock.metadata?.name) {
      blockNameMapping[normalizeName(workflowBlock.metadata.name)] = id
    }

    // Build output schema from block type and params
    const blockType = workflowBlock.metadata?.id
    if (blockType) {
      const params = workflowBlock.config?.params as Record<string, unknown> | undefined
      const subBlocks = params
        ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { value: v }]))
        : undefined
      const schema = getBlockOutputs(blockType, subBlocks)
      if (schema && Object.keys(schema).length > 0) {
        blockOutputSchemas[id] = schema
      }
    }
  }

  return { blockData, blockNameMapping, blockOutputSchemas }
}
