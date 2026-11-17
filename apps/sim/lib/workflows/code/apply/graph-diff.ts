import { compareStrings } from '@sim/utils/string'
import { BLOCK_LAYOUT_DATA_FIELDS, BLOCK_LAYOUT_FIELDS } from '@sim/workflow-code/layout'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'

/** The two parts of a stored graph the source gates compare. */
export type SourceGraph = Pick<WorkflowState, 'blocks' | 'edges'>

type GraphEdge = WorkflowState['edges'][number]

/**
 * Block keys that only place a block on the canvas. Source apply keeps stored layout for
 * existing blocks, so a difference here is never a semantic change.
 */
const LAYOUT_BLOCK_KEYS: ReadonlySet<string> = new Set(BLOCK_LAYOUT_FIELDS)
const LAYOUT_DATA_KEYS: ReadonlySet<string> = new Set(BLOCK_LAYOUT_DATA_FIELDS)

/** One block present on both sides whose semantic content differs. */
interface ModifiedBlock {
  id: string
  /** Subblock ids whose stored entry differs, in sorted order. */
  subBlocks: string[]
  /** Other block keys that differ (`name`, `type`, `enabled`, `locked`, `data.count`, ...), sorted. */
  attributes: string[]
  typeChanged: boolean
  parentChanged: boolean
  lockedChanged: boolean
  enabledChanged: boolean
}

/**
 * A block- and field-level diff of two graphs, keyed by block id. Edges are keyed by their
 * endpoints and handles, never their id: materialize reuses a stored edge's id whenever its
 * tuple survives, so the tuple is the edge's identity.
 */
export interface GraphDiff {
  added: string[]
  removed: string[]
  modified: ModifiedBlock[]
  edgesAdded: GraphEdge[]
  edgesRemoved: GraphEdge[]
}

/** The container a block sits in, or `undefined` at the top level. */
export function parentIdOf(block: BlockState | undefined): string | undefined {
  const parentId = block?.data?.parentId
  return typeof parentId === 'string' && parentId.length > 0 ? parentId : undefined
}

/** `locked` is optional and stored as null or absent when off. */
export function isLocked(block: BlockState | undefined): boolean {
  return block?.locked === true
}

function edgeKey(edge: GraphEdge): string {
  return JSON.stringify([
    edge.source,
    edge.sourceHandle ?? null,
    edge.target,
    edge.targetHandle ?? null,
  ])
}

function semanticData(block: BlockState): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block.data ?? {})) {
    if (!LAYOUT_DATA_KEYS.has(key) && value !== undefined) data[key] = value
  }
  return data
}

function diffBlock(base: BlockState, target: BlockState): ModifiedBlock | null {
  const subBlocks: string[] = []
  const subBlockIds = new Set([
    ...Object.keys(base.subBlocks ?? {}),
    ...Object.keys(target.subBlocks ?? {}),
  ])
  for (const id of subBlockIds) {
    if (!isEqual(base.subBlocks?.[id], target.subBlocks?.[id])) subBlocks.push(id)
  }

  const attributes: string[] = []
  const blockKeys = new Set([...Object.keys(base), ...Object.keys(target)])
  for (const key of blockKeys) {
    if (key === 'subBlocks' || key === 'data' || LAYOUT_BLOCK_KEYS.has(key)) continue
    const before = base[key as keyof BlockState]
    const after = target[key as keyof BlockState]
    if (key === 'locked' ? isLocked(base) !== isLocked(target) : !isEqual(before, after)) {
      attributes.push(key)
    }
  }
  const baseData = semanticData(base)
  const targetData = semanticData(target)
  for (const key of new Set([...Object.keys(baseData), ...Object.keys(targetData)])) {
    if (!isEqual(baseData[key], targetData[key])) attributes.push(`data.${key}`)
  }

  if (subBlocks.length === 0 && attributes.length === 0) return null
  subBlocks.sort(compareStrings)
  attributes.sort(compareStrings)
  return {
    id: target.id,
    subBlocks,
    attributes,
    typeChanged: base.type !== target.type,
    parentChanged: parentIdOf(base) !== parentIdOf(target),
    lockedChanged: isLocked(base) !== isLocked(target),
    enabledChanged: base.enabled !== target.enabled,
  }
}

/** Diffs base against target by block id. Layout-only differences are ignored. */
export function diffGraphs(base: SourceGraph, target: SourceGraph): GraphDiff {
  const added: string[] = []
  const removed: string[] = []
  const modified: ModifiedBlock[] = []

  for (const id of Object.keys(target.blocks)) {
    const before = base.blocks[id]
    if (!before) {
      added.push(id)
      continue
    }
    const change = diffBlock(before, target.blocks[id])
    if (change) modified.push(change)
  }
  for (const id of Object.keys(base.blocks)) {
    if (!target.blocks[id]) removed.push(id)
  }

  const baseEdges = new Map(base.edges.map((edge) => [edgeKey(edge), edge]))
  const targetEdges = new Map(target.edges.map((edge) => [edgeKey(edge), edge]))
  const edgesAdded = [...targetEdges].filter(([key]) => !baseEdges.has(key)).map(([, e]) => e)
  const edgesRemoved = [...baseEdges].filter(([key]) => !targetEdges.has(key)).map(([, e]) => e)

  added.sort(compareStrings)
  removed.sort(compareStrings)
  modified.sort((a, b) => compareStrings(a.id, b.id))
  return { added, removed, modified, edgesAdded, edgesRemoved }
}
