import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import type { ReferenceNode } from '@/lib/api/contracts/workflow-references'
import { getCustomBlockRowsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import { CUSTOM_BLOCK_TYPE_PREFIX } from '@/blocks/custom/build-config'
import { BlockType, isWorkflowBlockType } from '@/executor/constants'

const logger = createLogger('WorkflowReferences')

/**
 * Depth ceiling for a reference tree — mirrors `MAX_CALL_CHAIN_DEPTH` in
 * `@/lib/execution/call-chain`. The per-path visited set is the real cycle guard;
 * this is a belt-and-suspenders bound on pathological graphs.
 */
const MAX_REFERENCE_DEPTH = 25

/** A workspace-local, non-archived workflow node. */
export interface WorkflowNode {
  id: string
  name: string
}

/** A placed block that may reference another workflow (raw, pre-resolution). */
export interface ReferenceBlockRow {
  parentId: string
  type: string
  /** `workflowId` sub-block value (basic mode), if a workflow block. */
  childFromSelector: string | null
  /** `manualWorkflowId` sub-block value (advanced mode), if a workflow block. */
  childFromManual: string | null
}

/** A custom-block type slug bound to its source workflow. */
export interface CustomBlockLink {
  type: string
  workflowId: string
}

/**
 * The workspace-wide reference graph derived from live editor state: every
 * workflow node's name, plus forward (callee) and reverse (caller) adjacency.
 */
interface ReferenceGraph {
  nameById: Map<string, string>
  forward: Map<string, Set<string>>
  reverse: Map<string, Set<string>>
}

/**
 * Build the directed reference graph from raw workspace rows. Pure (no I/O) so it
 * can be unit-tested directly. Resolves two reference shapes:
 * - direct **workflow blocks** (`workflow` and `workflow_input`), whose child id
 *   is the `workflowId` (basic) or `manualWorkflowId` (advanced) sub-block value; and
 * - **custom blocks** (`custom_block_<id>`), whose type slug maps to a bound
 *   source workflow via `customBlocks`.
 *
 * Edges are scoped to workspace-local, non-archived workflows: self-references,
 * empty values, and ids outside `workflows` are dropped.
 */
export function buildReferenceGraph(
  workflows: WorkflowNode[],
  blocks: ReferenceBlockRow[],
  customBlocks: CustomBlockLink[]
): ReferenceGraph {
  const nameById = new Map<string, string>()
  for (const node of workflows) nameById.set(node.id, node.name)

  const sourceByCustomType = new Map<string, string>()
  for (const link of customBlocks) sourceByCustomType.set(link.type, link.workflowId)

  const forward = new Map<string, Set<string>>()
  const reverse = new Map<string, Set<string>>()

  const addEdge = (parentId: string, childId: string) => {
    if (!childId || childId === parentId) return
    if (!nameById.has(parentId) || !nameById.has(childId)) return
    if (!forward.has(parentId)) forward.set(parentId, new Set())
    forward.get(parentId)?.add(childId)
    if (!reverse.has(childId)) reverse.set(childId, new Set())
    reverse.get(childId)?.add(parentId)
  }

  for (const block of blocks) {
    if (isWorkflowBlockType(block.type)) {
      const childId = block.childFromSelector || block.childFromManual
      if (childId) addEdge(block.parentId, childId)
      continue
    }
    const sourceId = sourceByCustomType.get(block.type)
    if (sourceId) addEdge(block.parentId, sourceId)
  }

  return { nameById, forward, reverse }
}

/**
 * Expand a direction of the graph into a tree rooted at `rootId`. `adjacency` is
 * either the forward (callees) or reverse (callers) map. A node already on the
 * current DFS path is emitted as a `cycle: true` leaf and not re-expanded, so
 * `A → B → A` terminates. Children are sorted by name for stable rendering.
 */
function buildTree(
  rootId: string,
  adjacency: Map<string, Set<string>>,
  nameById: Map<string, string>
): ReferenceNode[] {
  const path = new Set<string>([rootId])

  const expand = (id: string, depth: number): ReferenceNode[] => {
    if (depth >= MAX_REFERENCE_DEPTH) return []
    const neighbors = adjacency.get(id)
    if (!neighbors || neighbors.size === 0) return []

    const sorted = [...neighbors].sort((a, b) => {
      const nameA = nameById.get(a) ?? a
      const nameB = nameById.get(b) ?? b
      return nameA.localeCompare(nameB)
    })

    const nodes: ReferenceNode[] = []
    for (const childId of sorted) {
      const name = nameById.get(childId) ?? childId
      if (path.has(childId)) {
        nodes.push({ id: childId, name, cycle: true, children: [] })
        continue
      }
      path.add(childId)
      nodes.push({ id: childId, name, cycle: false, children: expand(childId, depth + 1) })
      path.delete(childId)
    }
    return nodes
  }

  return expand(rootId, 0)
}

/**
 * Resolve the reference trees for one workflow from raw workspace rows. Pure so it
 * can be unit-tested without a database. Returns empty arrays when the workflow is
 * not a workspace-local node or has no references.
 */
export function resolveWorkflowReferences(
  workflowId: string,
  workflows: WorkflowNode[],
  blocks: ReferenceBlockRow[],
  customBlocks: CustomBlockLink[]
): { callers: ReferenceNode[]; callees: ReferenceNode[] } {
  const { nameById, forward, reverse } = buildReferenceGraph(workflows, blocks, customBlocks)

  if (!nameById.has(workflowId)) {
    return { callers: [], callees: [] }
  }

  return {
    callers: buildTree(workflowId, reverse, nameById),
    callees: buildTree(workflowId, forward, nameById),
  }
}

/**
 * Resolve the reference trees for one workflow: `callers` (workflows that call
 * it, inbound) and `callees` (workflows it calls, outbound), read from the live
 * `workflowBlocks` (draft) table — the state the sidebar and editor show. The
 * root itself is not a node; each array holds its direct references, recursively
 * expanded.
 */
export async function getWorkflowReferences(
  workspaceId: string,
  workflowId: string
): Promise<{ callers: ReferenceNode[]; callees: ReferenceNode[] }> {
  const [workflowRows, blockRows, customBlockRows] = await Promise.all([
    db
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt))),
    db
      .select({
        parentId: workflowBlocks.workflowId,
        type: workflowBlocks.type,
        childFromSelector: sql<
          string | null
        >`${workflowBlocks.subBlocks} -> 'workflowId' ->> 'value'`,
        childFromManual: sql<
          string | null
        >`${workflowBlocks.subBlocks} -> 'manualWorkflowId' ->> 'value'`,
      })
      .from(workflowBlocks)
      .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
      .where(
        and(
          eq(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt),
          or(
            inArray(workflowBlocks.type, [BlockType.WORKFLOW, BlockType.WORKFLOW_INPUT]),
            like(workflowBlocks.type, `${CUSTOM_BLOCK_TYPE_PREFIX}%`)
          )
        )
      ),
    getCustomBlockRowsForWorkspace(workspaceId),
  ])

  const result = resolveWorkflowReferences(
    workflowId,
    workflowRows,
    blockRows,
    customBlockRows.map((row) => ({ type: row.type, workflowId: row.workflowId }))
  )

  if (!workflowRows.some((row) => row.id === workflowId)) {
    logger.warn('Workflow not found in workspace when resolving references', {
      workspaceId,
      workflowId,
    })
  }

  return result
}
