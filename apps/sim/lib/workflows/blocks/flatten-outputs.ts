/**
 * Flatten workflow block outputs into pickable paths.
 *
 * Shared helper used by any UI that needs to let a user pick one (or many) of a
 * workflow's block outputs — deploy modal's OutputSelect, the table workflow-column
 * config sidebar, etc. Keeping this in one place means the "what counts as an
 * output" rules (excluded types, trigger-mode handling, recursion into nested
 * output shapes, BFS sort order) don't drift between consumers.
 */

import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/block-outputs'

/**
 * Block types whose "outputs" are really workflow inputs (Start/starter) or flow
 * control and should never appear in an output picker.
 */
export const EXCLUDED_OUTPUT_TYPES = new Set(['starter', 'start_trigger', 'human_in_the_loop'])

export interface FlattenedBlockOutput {
  blockId: string
  blockName: string
  blockType: string
  /** Dot-path into the block's output (e.g. `content`, `content.text`). */
  path: string
  /** Type from the block's output schema (e.g. `string`, `number`, `json`).
   *  Used by the table column-sidebar to pick the right column type. */
  leafType?: string
}

/**
 * Minimal shape we need off each block — compatible with both the normalized
 * WorkflowState.blocks entries and the editor's live block state.
 */
export interface FlattenOutputsBlockInput {
  id: string
  type: string
  name?: string
  triggerMode?: boolean
  subBlocks?: Record<string, unknown>
}

export interface FlattenOutputsEdgeInput {
  source: string
  target: string
}

/**
 * Compute a flat list of pickable output paths across every eligible block in
 * a workflow.
 *
 * @param blocks Iterable of blocks from the workflow state.
 * @param edges  Optional edge list — when provided, results are sorted by BFS
 *   distance from a start/trigger block (descending), so terminal blocks
 *   appear first. This matches the deploy modal's grouping order.
 */
export function flattenWorkflowOutputs(
  blocks: Iterable<FlattenOutputsBlockInput>,
  edges: Iterable<FlattenOutputsEdgeInput> = []
): FlattenedBlockOutput[] {
  const blockList = Array.from(blocks)
  const results: FlattenedBlockOutput[] = []

  for (const block of blockList) {
    if (!block?.id || !block?.type) continue
    if (EXCLUDED_OUTPUT_TYPES.has(block.type)) continue

    const normalizedSubBlocks: Record<string, { value: unknown }> = {}
    if (block.subBlocks && typeof block.subBlocks === 'object') {
      for (const [k, v] of Object.entries(block.subBlocks)) {
        normalizedSubBlocks[k] =
          v && typeof v === 'object' && 'value' in (v as object)
            ? (v as { value: unknown })
            : { value: v }
      }
    }

    const effectiveTriggerMode = Boolean(block.triggerMode)
    let outs: Record<string, unknown> = {}
    try {
      outs = getEffectiveBlockOutputs(block.type, normalizedSubBlocks, {
        triggerMode: effectiveTriggerMode,
        preferToolOutputs: !effectiveTriggerMode,
      }) as Record<string, unknown>
    } catch {
      continue
    }
    if (!outs || Object.keys(outs).length === 0) continue

    const blockName = block.name || `Block ${block.id}`
    const add = (path: string, outputObj: unknown, prefix = ''): void => {
      const fullPath = prefix ? `${prefix}.${path}` : path
      const declaredType =
        outputObj &&
        typeof outputObj === 'object' &&
        !Array.isArray(outputObj) &&
        'type' in (outputObj as object) &&
        typeof (outputObj as { type: unknown }).type === 'string'
          ? (outputObj as { type: string }).type
          : undefined
      const isLeaf =
        typeof outputObj !== 'object' ||
        outputObj === null ||
        declaredType !== undefined ||
        Array.isArray(outputObj)
      if (isLeaf) {
        results.push({
          blockId: block.id,
          blockName,
          blockType: block.type,
          path: fullPath,
          leafType: declaredType,
        })
        return
      }
      for (const [key, value] of Object.entries(outputObj as Record<string, unknown>)) {
        add(key, value, fullPath)
      }
    }

    for (const [key, value] of Object.entries(outs)) add(key, value)
  }

  const edgeList = Array.from(edges)
  if (edgeList.length === 0 || results.length === 0) return results

  // Sort by BFS distance from the first start/trigger block, descending — so terminal
  // blocks group to the top. Matches the deploy modal's OutputSelect ordering.
  const startBlock = blockList.find(
    (b) => b.type === 'starter' || b.type === 'start_trigger' || !!b.triggerMode
  )
  if (!startBlock) return results

  const adj: Record<string, string[]> = {}
  for (const e of edgeList) {
    if (!adj[e.source]) adj[e.source] = []
    adj[e.source].push(e.target)
  }
  const distances: Record<string, number> = {}
  const visited = new Set<string>()
  const queue: Array<[string, number]> = [[startBlock.id, 0]]
  while (queue.length > 0) {
    const [id, d] = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    distances[id] = d
    for (const t of adj[id] ?? []) queue.push([t, d + 1])
  }

  return results
    .map((r, i) => ({ r, d: distances[r.blockId] ?? -1, i }))
    .sort((a, b) => {
      if (b.d !== a.d) return b.d - a.d
      return a.i - b.i // preserve discovery order within the same distance
    })
    .map(({ r }) => r)
}

/**
 * BFS distance from the workflow's start/trigger block to every reachable block,
 * keyed by blockId. Blocks unreachable from start get `-1`. Pure function over
 * the same `blocks`/`edges` shape `flattenWorkflowOutputs` accepts; callers that
 * want a *start-first* (execution-order ASC) sort use this map directly instead
 * of `flattenWorkflowOutputs` (which sorts terminal-blocks-first for picker UX).
 */
export function getBlockExecutionOrder(
  blocks: Iterable<FlattenOutputsBlockInput>,
  edges: Iterable<FlattenOutputsEdgeInput>
): Record<string, number> {
  const blockList = Array.from(blocks)
  const startBlock = blockList.find(
    (b) => b.type === 'starter' || b.type === 'start_trigger' || !!b.triggerMode
  )
  const distances: Record<string, number> = {}
  for (const b of blockList) {
    if (b?.id) distances[b.id] = -1
  }
  if (!startBlock) return distances

  const adj: Record<string, string[]> = {}
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = []
    adj[e.source].push(e.target)
  }
  const visited = new Set<string>()
  const queue: Array<[string, number]> = [[startBlock.id, 0]]
  while (queue.length > 0) {
    const [id, d] = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    distances[id] = d
    for (const t of adj[id] ?? []) queue.push([t, d + 1])
  }
  return distances
}
