/**
 * Whether a workflow, called as a child, always answers with its Response block's output.
 */
import {
  alwaysEndsAtResponse,
  isElseConditionTitle,
  type ResponseGraphBlock,
} from '@sim/workflow-types/workflow'
import { storedTitle } from './canonicalize/branches'
import type { CanonicalBlock, CanonicalWorkflow, Port } from './model'

/**
 * The branches `block` always takes one of (as `getAlwaysTakenBranchHandles` reads stored
 * blocks): every route of a router, and every row of a condition with an else row (by stored
 * title, as the executor finds it); none for branches never saved.
 */
function alwaysTakenBranches(block: CanonicalBlock): ResponseGraphBlock['branches'] {
  const branches = block.branches
  if (!branches) return undefined
  const rows = branches.rows ?? []
  const hasElse = rows.some((row, index) =>
    isElseConditionTitle(storedTitle(branches.kind, row, index, rows.length))
  )
  return branches.kind === 'condition' && !hasElse ? [] : rows.map((row) => row.key)
}

function portName(port: Port): string {
  return port.kind === 'branch' ? `branch:${port.key}` : port.kind
}

/**
 * Whether every run of `workflow` ends at an enabled Response block at its root, so a Workflow
 * block calling it reads that block's output, `{ data, status, headers }`, as its `result`
 * ({@link alwaysEndsAtResponse}).
 */
export function respondsOnEveryRun(workflow: CanonicalWorkflow): boolean {
  const blocks: Record<string, ResponseGraphBlock> = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    const branches = alwaysTakenBranches(block)
    blocks[key] = {
      type: block.type,
      enabled: block.enabled,
      parentId: block.parent,
      ...(branches !== undefined && { branches }),
    }
  }
  return alwaysEndsAtResponse(
    blocks,
    workflow.edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      port: portName(edge.port),
    }))
  )
}
