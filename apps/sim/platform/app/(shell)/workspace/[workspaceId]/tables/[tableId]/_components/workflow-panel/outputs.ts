import { type InputFormatField, normalizeInputFormatValue } from '@/platform/lib/data/tables'
import {
  flattenWorkflowOutputs,
  getBlockExecutionOrder,
  isAnnotationOnlyBlock,
  TriggerUtils,
  type WorkflowState,
} from '@/platform/lib/data/workflows'

const OUTPUT_VALUE_SEPARATOR = '::'

/** A picker value for one block output: the block id and its output path, in one string. */
export function encodeOutputValue(blockId: string, path: string): string {
  return `${blockId}${OUTPUT_VALUE_SEPARATOR}${path}`
}

function decodeOutputValue(value: string): { blockId: string; path: string } {
  const index = value.indexOf(OUTPUT_VALUE_SEPARATOR)
  if (index === -1) return { blockId: '', path: value }
  return {
    blockId: value.slice(0, index),
    path: value.slice(index + OUTPUT_VALUE_SEPARATOR.length),
  }
}

/** A block's place in the run, start first; a block the start never reaches sorts last. */
function executionRank(distances: Record<string, number>, blockId: string): number {
  const distance = distances[blockId]
  return distance === undefined || distance < 0 ? Number.POSITIVE_INFINITY : distance
}

/** The input fields of the Start block a table run executes, from the active deployment. */
export function startBlockInputs(state: WorkflowState | null | undefined): InputFormatField[] {
  if (!state?.blocks) return []
  const candidate = TriggerUtils.findStartBlock(state.blocks, 'manual')
  if (!candidate) return []
  return normalizeInputFormatValue(candidate.block.subBlocks?.inputFormat?.value)
}

interface BlockOutputGroup {
  blockId: string
  blockName: string
  paths: string[]
}

/** Every pickable output, grouped by its block, with the blocks in run order. */
export function blockOutputGroups(state: WorkflowState | null | undefined): BlockOutputGroup[] {
  if (!state?.blocks) return []
  const blocks = Object.values(state.blocks)
  const edges = state.edges ?? []
  const flat = flattenWorkflowOutputs(blocks, edges)
  if (flat.length === 0) return []
  const groups = new Map<string, BlockOutputGroup>()
  for (const output of flat) {
    let group = groups.get(output.blockId)
    if (!group) {
      group = { blockId: output.blockId, blockName: output.blockName, paths: [] }
      groups.set(output.blockId, group)
    }
    group.paths.push(output.path)
  }
  const distances = getBlockExecutionOrder(blocks, edges)
  return [...groups.values()].sort(
    (a, b) => executionRank(distances, a.blockId) - executionRank(distances, b.blockId)
  )
}

interface PickedOutput {
  blockId: string
  path: string
  leafType?: string
}

/**
 * The picked outputs, deduplicated and in run order (ties keep the flattened order), each with the
 * leaf type its new column takes.
 */
export function orderPickedOutputs(
  selected: readonly string[],
  state: WorkflowState | null | undefined
): PickedOutput[] {
  const outputs: PickedOutput[] = [...new Set(selected)].map(decodeOutputValue)
  if (!state?.blocks) return outputs
  const blocks = Object.values(state.blocks)
  const edges = state.edges ?? []
  const distances = getBlockExecutionOrder(blocks, edges)
  const flat = flattenWorkflowOutputs(blocks, edges)
  const indexInFlat = new Map(flat.map((f, i) => [encodeOutputValue(f.blockId, f.path), i]))
  const leafTypeByKey = new Map(flat.map((f) => [encodeOutputValue(f.blockId, f.path), f.leafType]))
  for (const output of outputs) {
    output.leafType = leafTypeByKey.get(encodeOutputValue(output.blockId, output.path))
  }
  return outputs.sort((a, b) => {
    const rankA = executionRank(distances, a.blockId)
    const rankB = executionRank(distances, b.blockId)
    if (rankA !== rankB) return rankA - rankB
    const ia = indexInFlat.get(encodeOutputValue(a.blockId, a.path)) ?? Number.POSITIVE_INFINITY
    const ib = indexInFlat.get(encodeOutputValue(b.blockId, b.path)) ?? Number.POSITIVE_INFINITY
    return ia - ib
  })
}

interface PreviewBlock {
  id: string
  name: string
  type: string
}

/** The deployment's blocks in run order, without canvas notes, for the compact preview. */
export function previewBlocks(state: WorkflowState | null | undefined): PreviewBlock[] {
  if (!state?.blocks) return []
  const blocks = Object.values(state.blocks).filter((block) => !isAnnotationOnlyBlock(block.type))
  const distances = getBlockExecutionOrder(blocks, state.edges ?? [])
  return blocks
    .map((block) => ({ id: block.id, name: block.name, type: block.type }))
    .sort((a, b) => executionRank(distances, a.id) - executionRank(distances, b.id))
}
