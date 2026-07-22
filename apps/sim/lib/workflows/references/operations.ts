import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { ReferenceNode } from '@/lib/api/contracts/workflow-references'
import { MAX_CALL_CHAIN_DEPTH } from '@/lib/execution/call-chain'
import { getCustomBlockRowsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import { coerceObjectArray, isRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import {
  type CanonicalGroup,
  type CanonicalModeOverrides,
  resolveActiveCanonicalValue,
  scopeCanonicalModesForTool,
} from '@/lib/workflows/subblocks/visibility'
import { CUSTOM_BLOCK_TYPE_PREFIX } from '@/blocks/custom/build-config'
import { BlockType, isWorkflowBlockType } from '@/executor/constants'

/**
 * Depth ceiling for a reference tree — the runtime call-chain bound; a display
 * tree never needs to show more than the executor allows. The per-path visited
 * set is the real cycle guard; this is a belt-and-suspenders bound on
 * pathological graphs.
 */
const MAX_REFERENCE_DEPTH = MAX_CALL_CHAIN_DEPTH

/**
 * The `workflowId` canonical pair on a workflow / workflow_input block: the basic
 * `workflowId` selector and the advanced `manualWorkflowId` input. Used with
 * {@link resolveActiveCanonicalValue} so the reference resolves to the value of the
 * block's ACTIVE mode — never a dormant mode's retained (stale) value.
 * (`remapWorkflowReferencesInSubBlocks` in
 * `@/lib/workflows/persistence/remap-internal-ids` builds the same pair from
 * positional keys — keep the two in sync if the pair ever changes.)
 */
const WORKFLOW_ID_CANONICAL_GROUP: CanonicalGroup = {
  canonicalId: 'workflowId',
  basicId: 'workflowId',
  advancedIds: ['manualWorkflowId'],
}

/** `custom_block_` with LIKE wildcards (`_`) escaped, for the SQL prefix match. */
const CUSTOM_BLOCK_LIKE_PREFIX = CUSTOM_BLOCK_TYPE_PREFIX.replace(/[\\%_]/g, '\\$&')

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
  /**
   * The block's `data.canonicalModes` override (basic/advanced per canonical id),
   * used to pick the active `workflowId` value. Absent for most blocks.
   */
  canonicalModes: CanonicalModeOverrides | null
  /**
   * Aggregated `tool-input` sub-block values on this block (agent-style tool
   * lists). Each entry is one sub-block's raw value — an array of tool objects,
   * or that array JSON-stringified. `workflow_input` tools carry the callee id
   * in `params.workflowId` (basic) or `params.manualWorkflowId` (advanced).
   * Null when the block has no tool-input sub-blocks.
   */
  toolInputValues: unknown[] | null
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
 * Callee workflow ids referenced by a block's tool-input values: workflow tools
 * (`workflow_input`, plus legacy stored entries typed `workflow`) resolved to
 * their ACTIVE canonical member — the basic `params.workflowId` selector or the
 * advanced `params.manualWorkflowId` input, per the tool's index-scoped
 * `canonicalModes` override ({@link scopeCanonicalModesForTool}) — mirroring how
 * execution picks the live value.
 */
function toolInputCallees(
  toolInputValues: unknown[] | null,
  canonicalModes: CanonicalModeOverrides | null
): string[] {
  if (!toolInputValues) return []
  const callees: string[] = []
  for (const value of toolInputValues) {
    const { array } = coerceObjectArray(value)
    if (!array) continue
    array.forEach((tool, toolIndex) => {
      if (
        !isRecord(tool) ||
        typeof tool.type !== 'string' ||
        !isWorkflowBlockType(tool.type) ||
        !isRecord(tool.params)
      ) {
        return
      }
      const scoped = scopeCanonicalModesForTool(canonicalModes ?? undefined, toolIndex, tool.type)
      const active = resolveActiveCanonicalValue(
        WORKFLOW_ID_CANONICAL_GROUP,
        {
          workflowId: typeof tool.params.workflowId === 'string' ? tool.params.workflowId : null,
          manualWorkflowId:
            typeof tool.params.manualWorkflowId === 'string' ? tool.params.manualWorkflowId : null,
        },
        scoped
      )
      if (typeof active === 'string' && active) callees.push(active)
    })
  }
  return callees
}

/**
 * Build the directed reference graph from raw workspace rows. Pure (no I/O) so it
 * can be unit-tested directly. Resolves three call-edge shapes:
 * - direct **workflow blocks** (`workflow` and `workflow_input`), whose child id
 *   is the `workflowId` (basic) or `manualWorkflowId` (advanced) sub-block value;
 * - **custom blocks** (`custom_block_<id>`), whose type slug maps to a bound
 *   source workflow via `customBlocks`; and
 * - **workflow tools** — `workflow_input` entries inside a block's `tool-input`
 *   sub-blocks (an agent invoking another workflow as a tool).
 *
 * Non-call reference shapes (the logs block's `workflowSelector` monitor list and
 * the workspace-event trigger's `workflowIds`; see
 * `remapWorkflowReferencesInSubBlocks`) are deliberately excluded — the viewer
 * shows call relationships.
 *
 * The workflow-block child is the value of the block's ACTIVE mode
 * ({@link resolveActiveCanonicalValue}), so a dormant basic/advanced value can't
 * mask the live one. Edges are scoped to workspace-local, non-archived workflows;
 * empty values and ids outside `workflows` are dropped. A workflow that calls
 * itself is kept — the tree builder renders it as a `cycle` leaf.
 */
function buildReferenceGraph(
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
    if (!childId) return
    if (!nameById.has(parentId) || !nameById.has(childId)) return
    let callees = forward.get(parentId)
    if (!callees) forward.set(parentId, (callees = new Set()))
    callees.add(childId)
    let callers = reverse.get(childId)
    if (!callers) reverse.set(childId, (callers = new Set()))
    callers.add(parentId)
  }

  for (const block of blocks) {
    if (isWorkflowBlockType(block.type)) {
      const active = resolveActiveCanonicalValue(
        WORKFLOW_ID_CANONICAL_GROUP,
        { workflowId: block.childFromSelector, manualWorkflowId: block.childFromManual },
        block.canonicalModes ?? undefined
      )
      if (typeof active === 'string' && active) addEdge(block.parentId, active)
    } else {
      const sourceId = sourceByCustomType.get(block.type)
      if (sourceId) addEdge(block.parentId, sourceId)
    }
    for (const calleeId of toolInputCallees(block.toolInputValues, block.canonicalModes)) {
      addEdge(block.parentId, calleeId)
    }
  }

  return { nameById, forward, reverse }
}

/**
 * Expand a direction of the graph into a tree rooted at `rootId`. `adjacency` is
 * either the forward (callees) or reverse (callers) map.
 *
 * A node already on the current DFS path is emitted as a `cycle: true` leaf and
 * not re-expanded, so `A → B → A` (and a self-call `A → A`) terminates. A node
 * already fully expanded elsewhere in this tree (reachable via another acyclic
 * path — a diamond) is emitted once more as a plain leaf without re-expanding its
 * subtree: the edge stays visible, but a densely reconverging graph can't blow up
 * exponentially. Children are sorted by name for stable rendering.
 */
function buildTree(
  rootId: string,
  adjacency: Map<string, Set<string>>,
  nameById: Map<string, string>
): ReferenceNode[] {
  const path = new Set<string>([rootId])
  const expanded = new Set<string>()
  const nameOf = (id: string) => nameById.get(id) as string

  const expand = (id: string, depth: number): ReferenceNode[] => {
    if (depth >= MAX_REFERENCE_DEPTH) return []
    const neighbors = adjacency.get(id)
    if (!neighbors || neighbors.size === 0) return []

    const sorted = [...neighbors].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))

    const nodes: ReferenceNode[] = []
    for (const childId of sorted) {
      const name = nameOf(childId)
      if (path.has(childId)) {
        nodes.push({ id: childId, name, cycle: true, children: [] })
        continue
      }
      if (expanded.has(childId)) {
        nodes.push({ id: childId, name, cycle: false, children: [] })
        continue
      }
      expanded.add(childId)
      path.add(childId)
      nodes.push({ id: childId, name, cycle: false, children: expand(childId, depth + 1) })
      path.delete(childId)
      // A depth-capped expansion is incomplete — allow a shallower path to retry
      // it in full instead of collapsing to a leaf. Each retry starts strictly
      // shallower, so this stays bounded.
      if (depth + 1 >= MAX_REFERENCE_DEPTH) expanded.delete(childId)
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
  const hasToolInput = sql`EXISTS (
    SELECT 1 FROM jsonb_each(${workflowBlocks.subBlocks}) AS kv
    WHERE kv.value ->> 'type' = 'tool-input'
  )`

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
        canonicalModes: sql<CanonicalModeOverrides | null>`${workflowBlocks.data} -> 'canonicalModes'`,
        toolInputValues: sql<unknown[] | null>`(
          SELECT jsonb_agg(kv.value -> 'value')
          FROM jsonb_each(${workflowBlocks.subBlocks}) AS kv
          WHERE kv.value ->> 'type' = 'tool-input'
        )`,
      })
      .from(workflowBlocks)
      .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
      .where(
        and(
          eq(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt),
          or(
            inArray(workflowBlocks.type, [BlockType.WORKFLOW, BlockType.WORKFLOW_INPUT]),
            sql`${workflowBlocks.type} LIKE ${`${CUSTOM_BLOCK_LIKE_PREFIX}%`} ESCAPE '\\'`,
            hasToolInput
          )
        )
      ),
    getCustomBlockRowsForWorkspace(workspaceId),
  ])

  return resolveWorkflowReferences(workflowId, workflowRows, blockRows, customBlockRows)
}
