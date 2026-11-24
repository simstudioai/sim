import { compareStrings } from '@sim/utils/string'
import {
  type BlockState,
  getWorkflowEdgeScopeDropReason,
  normalizeWorkflowEdgeSourceHandle,
  parseWorkflowSourceHandle,
  type WorkflowBranchKind,
} from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import { edgeTupleKey, portKey } from '../anchors'
import { diagnostic } from '../diagnostics/factory'
import type { BranchKey, CanonicalEdge, Port } from '../model'
import type { CanonContext } from './context'

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
  branchKeys: Map<string, { kind: WorkflowBranchKind; keyByRowId: Map<string, BranchKey> }>
}

function sourcePort(
  handle: string | null,
  source: BlockState,
  sourceId: string,
  inputs: EdgeInputs
): Port {
  const branches = inputs.branchKeys.get(sourceId)
  const parsed = parseWorkflowSourceHandle(handle, source.type, branches?.kind)
  if (parsed.kind !== 'branch') return parsed
  const key = branches?.keyByRowId.get(parsed.rowId)
  return key === undefined ? { kind: 'raw', handle: parsed.handle } : { kind: 'branch', key }
}

/**
 * Edges by `(from, port, to)`. Handles heal on read
 * (side-anchored ids and `''` collapse, `normalizeWorkflowEdgeSourceHandle`); `condition-<rowId>` /
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
      context.diagnostics.push(
        diagnostic(
          'W_CANON_DANGLING_EDGE',
          `Edge ${edge.source} -> ${edge.target} references a missing block; dropped`,
          {
            ...(from !== undefined ? { blockKey: from } : {}),
          }
        )
      )
      continue
    }

    const handle = normalizeWorkflowEdgeSourceHandle(edge.sourceHandle)
    const port = sourcePort(handle, source, edge.source, inputs)
    const identity = edgeTupleKey(from, portKey(port), to)
    if (seen.has(identity)) continue
    seen.add(identity)
    if (port.kind === 'error') errorSourceIds.add(edge.source)
    if (port.kind === 'raw') {
      context.diagnostics.push(
        diagnostic(
          'W_CANON_RAW_HANDLE',
          `Edge from "${from}" leaves unknown handle "${port.handle}"; kept as a raw port`,
          {
            blockKey: from,
          }
        )
      )
    }
    const scopeProblem = getWorkflowEdgeScopeDropReason(edge, inputs.blocks)
    if (scopeProblem) {
      context.diagnostics.push(
        diagnostic('E_CANON_EDGE_SCOPE', `Edge ${from} -> ${to}: ${scopeProblem}`, {
          blockKey: from,
        })
      )
    }

    result.push({ from, port, to })
  }

  result.sort(compareEdges)
  return { edges: result, errorSourceIds }
}
