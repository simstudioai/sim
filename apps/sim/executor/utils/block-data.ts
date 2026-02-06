import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
} from '@/lib/core/utils/response-format'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { isTriggerBehavior, normalizeName } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { OutputSchema } from '@/executor/utils/block-reference'
import {
  extractBaseBlockId,
  extractBranchIndex,
  isBranchNodeId,
} from '@/executor/utils/subflow-utils'
import type { SerializedBlock } from '@/serializer/types'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

export interface BlockDataCollection {
  blockData: Record<string, unknown>
  blockNameMapping: Record<string, string>
  blockOutputSchemas: Record<string, OutputSchema>
}

/**
 * Block types where inputFormat fields should be merged into outputs schema.
 * These are blocks where users define custom fields via inputFormat that become
 * valid output paths (e.g., <start.myField>, <webhook1.customField>, <hitl1.resumeField>).
 *
 * Note: This includes non-trigger blocks like 'starter' and 'human_in_the_loop' which
 * have category 'blocks' but still need their inputFormat exposed as outputs.
 */
const BLOCKS_WITH_INPUT_FORMAT_OUTPUTS = [
  'start_trigger',
  'starter',
  'api_trigger',
  'input_trigger',
  'generic_webhook',
  'human_in_the_loop',
] as const

function getInputFormatFields(block: SerializedBlock): OutputSchema {
  const inputFormat = normalizeInputFormatValue(block.config?.params?.inputFormat)
  if (inputFormat.length === 0) {
    return {}
  }

  const schema: OutputSchema = {}
  for (const field of inputFormat) {
    if (!field.name) continue
    schema[field.name] = { type: field.type || 'any' }
  }

  return schema
}

function getEvaluatorMetricsSchema(block: SerializedBlock): OutputSchema | undefined {
  if (block.metadata?.id !== 'evaluator') return undefined

  const metrics = block.config?.params?.metrics
  if (!Array.isArray(metrics) || metrics.length === 0) return undefined

  const validMetrics = metrics.filter(
    (m: { name?: string }) => m?.name && typeof m.name === 'string'
  )
  if (validMetrics.length === 0) return undefined

  const schema: OutputSchema = { ...(block.outputs as OutputSchema) }
  for (const metric of validMetrics) {
    schema[metric.name.toLowerCase()] = { type: 'number' }
  }
  return schema
}

function getResponseFormatSchema(block: SerializedBlock): OutputSchema | undefined {
  const responseFormatValue = block.config?.params?.responseFormat
  if (!responseFormatValue) return undefined

  const parsed = parseResponseFormatSafely(responseFormatValue, block.id)
  if (!parsed) return undefined

  const fields = extractFieldsFromSchema(parsed)
  if (fields.length === 0) return undefined

  const schema: OutputSchema = {}
  for (const field of fields) {
    schema[field.name] = { type: field.type || 'any' }
  }
  return schema
}

export function getBlockSchema(
  block: SerializedBlock,
  toolConfig?: ToolConfig
): OutputSchema | undefined {
  const blockType = block.metadata?.id

  if (
    blockType &&
    BLOCKS_WITH_INPUT_FORMAT_OUTPUTS.includes(
      blockType as (typeof BLOCKS_WITH_INPUT_FORMAT_OUTPUTS)[number]
    )
  ) {
    const baseOutputs = (block.outputs as OutputSchema) || {}
    const inputFormatFields = getInputFormatFields(block)
    const merged = { ...baseOutputs, ...inputFormatFields }
    if (Object.keys(merged).length > 0) {
      return merged
    }
  }

  const evaluatorSchema = getEvaluatorMetricsSchema(block)
  if (evaluatorSchema) {
    return evaluatorSchema
  }

  const responseFormatSchema = getResponseFormatSchema(block)
  if (responseFormatSchema) {
    return responseFormatSchema
  }

  const isTrigger = isTriggerBehavior(block)

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

    const toolId = block.config?.tool
    const toolConfig = toolId ? getTool(toolId) : undefined
    const schema = getBlockSchema(block, toolConfig)
    if (schema && Object.keys(schema).length > 0) {
      blockOutputSchemas[id] = schema
    }
  }

  return { blockData, blockNameMapping, blockOutputSchemas }
}
