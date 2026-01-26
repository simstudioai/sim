import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
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

/**
 * Triggers where inputFormat fields should be merged into outputs schema.
 * These are blocks where users define custom fields via inputFormat that become
 * valid output paths (e.g., <start.myField>, <webhook1.customField>).
 */
const TRIGGERS_WITH_INPUT_FORMAT_OUTPUTS = [
  'start_trigger',
  'starter',
  'api_trigger',
  'input_trigger',
  'generic_webhook',
  'human_in_the_loop',
  'approval',
] as const

function getInputFormatFields(block: SerializedBlock): OutputSchema {
  const inputFormat = normalizeInputFormatValue(block.config?.params?.inputFormat)
  if (inputFormat.length === 0) {
    return {}
  }

  const schema: OutputSchema = {}
  for (const field of inputFormat) {
    schema[field.name!] = {
      type: (field.type || 'any') as 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any',
    }
  }

  return schema
}

export function getBlockSchema(
  block: SerializedBlock,
  toolConfig?: ToolConfig
): OutputSchema | undefined {
  const isTrigger =
    block.metadata?.category === 'triggers' ||
    (block.config?.params as Record<string, unknown> | undefined)?.triggerMode === true

  const blockType = block.metadata?.id

  if (
    isTrigger &&
    blockType &&
    TRIGGERS_WITH_INPUT_FORMAT_OUTPUTS.includes(
      blockType as (typeof TRIGGERS_WITH_INPUT_FORMAT_OUTPUTS)[number]
    )
  ) {
    const baseOutputs = (block.outputs as OutputSchema) || {}
    const inputFormatFields = getInputFormatFields(block)
    const merged = { ...baseOutputs, ...inputFormatFields }
    if (Object.keys(merged).length > 0) {
      return merged
    }
  }

  if (isTrigger && block.outputs && Object.keys(block.outputs).length > 0) {
    return block.outputs as OutputSchema
  }

  if (toolConfig?.outputs && Object.keys(toolConfig.outputs).length > 0) {
    return toolConfig.outputs as OutputSchema
  }

  if (block.outputs && Object.keys(block.outputs).length > 0) {
    return block.outputs as OutputSchema
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
