import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
} from '@/lib/core/utils/response-format'
import { getBlockOutputPaths } from '@/lib/workflows/blocks/block-outputs'
import { getBlock } from '@/blocks'
import { normalizeName } from '@/executor/constants'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable } from '@/stores/panel/variables/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

export interface WorkflowContext {
  workflowId: string
  blocks: Record<string, BlockState>
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  subBlockValues: Record<string, Record<string, any>>
}

export interface VariableOutput {
  id: string
  name: string
  type: string
  tag: string
}

export function getWorkflowSubBlockValues(workflowId: string): Record<string, Record<string, any>> {
  const subBlockStore = useSubBlockStore.getState()
  return subBlockStore.workflowValues[workflowId] ?? {}
}

export function getMergedSubBlocks(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>>,
  targetBlockId: string
): Record<string, any> {
  const base = blocks[targetBlockId]?.subBlocks || {}
  const live = subBlockValues?.[targetBlockId] || {}
  const merged: Record<string, any> = { ...base }
  for (const [subId, liveVal] of Object.entries(live)) {
    merged[subId] = { ...(base[subId] || {}), value: liveVal }
  }
  return merged
}

export function getSubBlockValue(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>>,
  targetBlockId: string,
  subBlockId: string
): any {
  const live = subBlockValues?.[targetBlockId]?.[subBlockId]
  if (live !== undefined) return live
  return blocks[targetBlockId]?.subBlocks?.[subBlockId]?.value
}

export function getWorkflowVariables(workflowId: string): VariableOutput[] {
  const getVariablesByWorkflowId = useVariablesStore.getState().getVariablesByWorkflowId
  const workflowVariables = getVariablesByWorkflowId(workflowId)
  const validVariables = workflowVariables.filter(
    (variable: Variable) => variable.name.trim() !== ''
  )
  return validVariables.map((variable: Variable) => ({
    id: variable.id,
    name: variable.name,
    type: variable.type,
    tag: `variable.${normalizeName(variable.name)}`,
  }))
}

export function getSubflowInsidePaths(
  blockType: 'loop' | 'parallel',
  blockId: string,
  loops: Record<string, Loop>,
  parallels: Record<string, Parallel>
): string[] {
  const paths = ['index']
  if (blockType === 'loop') {
    const loopType = loops[blockId]?.loopType || 'for'
    if (loopType === 'forEach') {
      paths.push('currentItem', 'items')
    }
  } else {
    const parallelType = parallels[blockId]?.parallelType || 'count'
    if (parallelType === 'collection') {
      paths.push('currentItem', 'items')
    }
  }
  return paths
}

export function computeBlockOutputPaths(block: BlockState, ctx: WorkflowContext): string[] {
  const { blocks, loops, parallels, subBlockValues } = ctx
  const blockConfig = getBlock(block.type)
  const mergedSubBlocks = getMergedSubBlocks(blocks, subBlockValues, block.id)

  if (block.type === 'loop' || block.type === 'parallel') {
    const insidePaths = getSubflowInsidePaths(block.type, block.id, loops, parallels)
    return ['results', ...insidePaths]
  }

  if (block.type === 'evaluator') {
    const metricsValue = getSubBlockValue(blocks, subBlockValues, block.id, 'metrics')
    if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
      const validMetrics = metricsValue.filter((metric: { name?: string }) => metric?.name)
      return validMetrics.map((metric: { name: string }) => metric.name.toLowerCase())
    }
    return getBlockOutputPaths(block.type, mergedSubBlocks)
  }

  if (block.type === 'variables') {
    const variablesValue = getSubBlockValue(blocks, subBlockValues, block.id, 'variables')
    if (variablesValue && Array.isArray(variablesValue) && variablesValue.length > 0) {
      const validAssignments = variablesValue.filter((assignment: { variableName?: string }) =>
        assignment?.variableName?.trim()
      )
      return validAssignments.map((assignment: { variableName: string }) =>
        assignment.variableName.trim()
      )
    }
    return []
  }

  if (blockConfig) {
    const responseFormatValue = mergedSubBlocks?.responseFormat?.value
    const responseFormat = parseResponseFormatSafely(responseFormatValue, block.id)
    if (responseFormat) {
      const schemaFields = extractFieldsFromSchema(responseFormat)
      if (schemaFields.length > 0) {
        return schemaFields.map((field) => field.name)
      }
    }
  }

  return getBlockOutputPaths(block.type, mergedSubBlocks, block.triggerMode)
}

export function formatOutputsWithPrefix(paths: string[], blockName: string): string[] {
  const normalizedName = normalizeName(blockName)
  return paths.map((path) => `${normalizedName}.${path}`)
}
