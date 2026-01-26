import { normalizeName } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { OutputSchema } from '@/executor/utils/block-reference'
import type { SerializedBlock } from '@/serializer/types'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

export interface BlockDataCollection {
  blockData: Record<string, unknown>
  blockNameMapping: Record<string, string>
  blockOutputSchemas: Record<string, OutputSchema>
}

export function getBlockSchema(
  block: SerializedBlock,
  toolConfig?: ToolConfig
): OutputSchema | undefined {
  if (block.outputs && Object.keys(block.outputs).length > 0) {
    return block.outputs as OutputSchema
  }

  if (toolConfig?.outputs && Object.keys(toolConfig.outputs).length > 0) {
    return toolConfig.outputs as OutputSchema
  }

  return undefined
}

export function collectBlockData(ctx: ExecutionContext): BlockDataCollection {
  const blockData: Record<string, unknown> = {}
  const blockNameMapping: Record<string, string> = {}
  const blockOutputSchemas: Record<string, OutputSchema> = {}

  for (const [id, state] of ctx.blockStates.entries()) {
    if (state.output !== undefined) {
      blockData[id] = state.output
    }
  }

  const workflowBlocks = ctx.workflow?.blocks ?? []
  for (const block of workflowBlocks) {
    const id = block.id

    if (block.metadata?.name) {
      blockNameMapping[normalizeName(block.metadata.name)] = id
    }

    const toolId = block.config?.tool
    const toolConfig = toolId ? getTool(toolId) : undefined
    const schema = getBlockSchema(block, toolConfig)
    if (schema && Object.keys(schema).length > 0) {
      blockOutputSchemas[id] = schema
    }
  }

  return { blockData, blockNameMapping, blockOutputSchemas }
}
