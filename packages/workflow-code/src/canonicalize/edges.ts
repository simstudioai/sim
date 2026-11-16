import { compareStrings } from '@sim/utils/string'
import {
  type BlockState,
  getWorkflowEdgeScopeDropReason,
  getWorkflowSubflowHandleIds,
  normalizeWorkflowEdgeSourceHandle,
  WORKFLOW_ERROR_HANDLE_ID,
  WORKFLOW_SOURCE_HANDLE_ID,
} from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import { portKey } from '../anchors'
import type { BranchKey, CanonicalEdge, Port } from '../model'
import { type CanonContext, report } from './context'

const CONDITION_HANDLE_PREFIX = 'condition-'
const ROUTER_HANDLE_PREFIX = 'router-'

/** Sorts edges by `(from, portKey, to)` with `compareStrings`. */
export function compareEdges(left: CanonicalEdge, right: CanonicalEdge): number {
  return (
    compareStrings(left.from, right.from) ||
    compareStrings(portKey(left.port), portKey(right.port)) ||
    compareStrings(left.to, right.to)
  )
}

export interface EdgeInputs {
  blocks: Record<string, BlockState>
  /** Block id → its branch kind and row-id → key map, for condition and router blocks. */
  branchKeys: Map<string, { kind: 'condition' | 'router'; keyByRowId: Map<string, BranchKey> }>
}

function sourcePort(
  handle: string | null,
  source: BlockState,
  sourceId: string,
  inputs: EdgeInputs
): Port {
  if (handle === null || handle === WORKFLOW_SOURCE_HANDLE_ID) return { kind: 'out' }
  if (handle === WORKFLOW_ERROR_HANDLE_ID) return { kind: 'error' }
  if (source.type === 'loop' || source.type === 'parallel') {
    const { start, end } = getWorkflowSubflowHandleIds(source.type)
    if (handle === start) return { kind: 'subflowStart' }
    if (handle === end) return { kind: 'subflowEnd' }
  }
  const branches = inputs.branchKeys.get(sourceId)
  if (branches) {
    const prefix = branches.kind === 'condition' ? CONDITION_HANDLE_PREFIX : ROUTER_HANDLE_PREFIX
    if (handle.startsWith(prefix)) {
      const key = branches.keyByRowId.get(handle.slice(prefix.length))
      if (key !== undefined) return { kind: 'branch', key }
    }
  }
  return { kind: 'raw', handle }
}

/**
 * Edges by `(from, port, to)` (s1 canonicalize step 7, quirks 5, 7, 20). Handles heal on read
 * (side-anchored ids and `''` collapse, workflow.ts:453-473); `condition-<rowId>` /
 * `router-<rowId>` become branch ports, `<kind>-start-source` / `-end-source` subflow ports, and
 * anything else a `raw` port with `W_CANON_RAW_HANDLE`. An edge to or from a missing block is
 * dropped (`W_CANON_DANGLING_EDGE`); a scope violation is kept and reported as an error
 * (`E_CANON_EDGE_SCOPE`). Duplicate tuples collapse to one.
 *
 * Returns the edges sorted plus the ids of blocks an error edge leaves (`errorPort`).
 */
export function canonicalEdges(
  edges: readonly Edge[],
  inputs: EdgeInputs,
  context: CanonContext
): { edges: CanonicalEdge[]; errorSourceIds: Set<string> } {
  const result: CanonicalEdge[] = []
  const seen = new Set<string>()
  const errorSourceIds = new Set<string>()

  for (const edge of edges) {
    const source = inputs.blocks[edge.source]
    const target = inputs.blocks[edge.target]
    const from = context.keyById.get(edge.source)
    const to = context.keyById.get(edge.target)
    if (!source || !target || from === undefined || to === undefined) {
      report(context, {
        code: 'W_CANON_DANGLING_EDGE',
        severity: 'warning',
        message: `Edge ${edge.source} -> ${edge.target} references a missing block; dropped`,
        ...(from !== undefined ? { blockKey: from } : {}),
      })
      continue
    }

    const handle = normalizeWorkflowEdgeSourceHandle(edge.sourceHandle)
    const port = sourcePort(handle, source, edge.source, inputs)
    if (port.kind === 'error') errorSourceIds.add(edge.source)
    if (port.kind === 'raw') {
      report(context, {
        code: 'W_CANON_RAW_HANDLE',
        severity: 'warning',
        message: `Edge from "${from}" leaves unknown handle "${port.handle}"; kept as a raw port`,
        blockKey: from,
      })
    }
    const scopeProblem = getWorkflowEdgeScopeDropReason(edge, inputs.blocks)
    if (scopeProblem) {
      report(context, {
        code: 'E_CANON_EDGE_SCOPE',
        severity: 'error',
        message: `Edge ${from} -> ${to}: ${scopeProblem}`,
        blockKey: from,
      })
    }

    const canonical: CanonicalEdge = { from, port, to }
    const identity = `${from}\u0000${portKey(port)}\u0000${to}`
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(canonical)
  }

  result.sort(compareEdges)
  return { edges: result, errorSourceIds }
}
