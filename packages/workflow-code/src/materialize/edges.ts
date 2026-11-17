import {
  type BlockState,
  getWorkflowBranchHandleId,
  getWorkflowSubflowHandleIds,
  normalizeWorkflowEdgeSourceHandle,
  parseWorkflowSourceHandle,
  WORKFLOW_ERROR_HANDLE_ID,
  WORKFLOW_SOURCE_HANDLE_ID,
  WORKFLOW_TARGET_HANDLE_ID,
  type WorkflowBranchKind,
} from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import { edgeTupleKey } from '../anchors'
import type { BlockKey, BranchKey, CanonicalEdge } from '../model'
import { getOwn } from '../records'
import type { MaterializeContext } from './context'

/** A block's branch handles: its branch kind and the row ids its keys stand for. */
export interface BranchHandles {
  kind: WorkflowBranchKind
  ids: Record<BranchKey, string>
}

/**
 * `(source id, port, target id)` with a branch port named by row id, so a stored edge and a
 * compiled one compare without keys. Mirrors canonicalize's port mapping (edges.ts `sourcePort`).
 */
function storedTupleKey(
  edge: Edge,
  blocks: Record<string, BlockState>,
  branches: ReadonlyMap<string, BranchHandles>
): string {
  const handle = normalizeWorkflowEdgeSourceHandle(edge.sourceHandle)
  return edgeTupleKey(
    edge.source,
    storedPort(handle, getOwn(blocks, edge.source), edge.source, branches),
    edge.target
  )
}

function storedPort(
  handle: string | null,
  source: BlockState | undefined,
  sourceId: string,
  branches: ReadonlyMap<string, BranchHandles>
): string {
  const handles = branches.get(sourceId)
  const port = parseWorkflowSourceHandle(handle, source?.type, handles?.kind)
  if (port.kind === 'branch' && handles && Object.values(handles.ids).includes(port.rowId)) {
    return `branch:${port.rowId}`
  }
  if (port.kind === 'branch' || port.kind === 'raw') return `raw:${port.handle}`
  return port.kind
}

/** The stored source handle a compiled port is written as. */
function sourceHandle(
  edge: CanonicalEdge,
  source: BlockState,
  sourceId: string,
  branches: ReadonlyMap<string, BranchHandles>
): string {
  switch (edge.port.kind) {
    case 'out':
      return WORKFLOW_SOURCE_HANDLE_ID
    case 'error':
      return WORKFLOW_ERROR_HANDLE_ID
    case 'raw':
      return edge.port.handle
    case 'subflowStart':
    case 'subflowEnd': {
      const type = source.type === 'parallel' ? 'parallel' : 'loop'
      const handles = getWorkflowSubflowHandleIds(type)
      return edge.port.kind === 'subflowStart' ? handles.start : handles.end
    }
    case 'branch': {
      const handles = branches.get(sourceId)
      return getWorkflowBranchHandleId(
        handles?.kind ?? 'condition',
        (handles && getOwn(handles.ids, edge.port.key)) ?? `${sourceId}-${edge.port.key}`
      )
    }
  }
}

export interface EdgeInputs {
  edges: CanonicalEdge[]
  idByKey: ReadonlyMap<BlockKey, string>
  blocks: Record<string, BlockState>
  branches: ReadonlyMap<string, BranchHandles>
  prevEdges: readonly Edge[]
  prevBlocks: Record<string, BlockState>
  prevBranches: ReadonlyMap<string, BranchHandles>
}

/**
 * Edges by tuple. Every prev edge whose tuple the workflow still has
 * is kept as the whole stored object (id, handles and extra fields), in stored order, including
 * duplicates of one tuple. A prev edge that already dangled in prev is kept unless an endpoint was
 * deleted now. Each remaining compiled edge is appended as a new edge in the editor's shape
 * (editing/builders.ts `createValidatedEdge`).
 */
export function writeEdges(inputs: EdgeInputs, context: MaterializeContext): Edge[] {
  const wanted = new Map<string, CanonicalEdge>()
  for (const edge of inputs.edges) {
    const from = inputs.idByKey.get(edge.from)
    const to = inputs.idByKey.get(edge.to)
    if (from === undefined || to === undefined) continue
    const source = inputs.blocks[from]
    const handle = sourceHandle(edge, source, from, inputs.branches)
    const port = storedPort(
      normalizeWorkflowEdgeSourceHandle(handle),
      source,
      from,
      inputs.branches
    )
    wanted.set(edgeTupleKey(from, port, to), edge)
  }

  const result: Edge[] = []
  const kept = new Set<string>()
  for (const edge of inputs.prevEdges) {
    const sourceKnown = Object.hasOwn(inputs.prevBlocks, edge.source)
    const targetKnown = Object.hasOwn(inputs.prevBlocks, edge.target)
    if (!sourceKnown || !targetKnown) {
      const survives =
        (!sourceKnown || Object.hasOwn(inputs.blocks, edge.source)) &&
        (!targetKnown || Object.hasOwn(inputs.blocks, edge.target))
      if (survives) result.push(edge)
      continue
    }
    const key = storedTupleKey(edge, inputs.prevBlocks, inputs.prevBranches)
    if (!wanted.has(key)) continue
    result.push(edge)
    kept.add(key)
  }

  for (const [key, edge] of wanted) {
    if (kept.has(key)) continue
    const from = inputs.idByKey.get(edge.from)
    const to = inputs.idByKey.get(edge.to)
    if (from === undefined || to === undefined) continue
    result.push({
      id: context.hooks.newId(),
      source: from,
      sourceHandle: sourceHandle(edge, inputs.blocks[from], from, inputs.branches),
      target: to,
      targetHandle: WORKFLOW_TARGET_HANDLE_ID,
      type: 'default',
    })
  }
  return result
}
