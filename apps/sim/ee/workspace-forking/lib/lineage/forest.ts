import { db } from '@sim/db'
import {
  workflow,
  workspace,
  workspaceForkPromoteRun,
  workspaceForkResourceMap,
} from '@sim/db/schema'
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type { ForkForestNode, ForkUndoableRun } from '@/lib/api/contracts/workspace-fork'
import { getEffectiveWorkspacePermission } from '@/lib/workspaces/permissions/utils'

/**
 * Ceiling on the fork graph one request will walk. Fork trees are shallow by construction — a
 * workspace has at most one parent — so this only ever trips on a pathological org, where
 * truncating beats timing out the settings page.
 */
const MAX_FOREST_NODES = 400

/** Ceiling on BFS rounds, so a cycle introduced by bad data cannot spin the walk forever. */
const MAX_FOREST_HOPS = 32

/**
 * Resource types that are never user-mappable, excluded from the edge's mapping counts: workflow
 * and workflow-publishing-server rows are system-managed identity, and a document rides its
 * parent knowledge base rather than being mapped on its own.
 */
const NON_MAPPABLE_RESOURCE_TYPES = [
  'workflow',
  'workflow_mcp_server',
  'knowledge_document',
] as const

interface ForestRow {
  id: string
  name: string
  color: string | null
  logoUrl: string | null
  organizationId: string | null
  parentId: string | null
  createdAt: Date
}

const WORKSPACE_COLUMNS = {
  id: workspace.id,
  name: workspace.name,
  color: workspace.color,
  logoUrl: workspace.logoUrl,
  organizationId: workspace.organizationId,
  parentId: workspace.forkedFromWorkspaceId,
  createdAt: workspace.createdAt,
} as const

/**
 * Every live workspace connected to `seedIds` through fork edges, walking BOTH directions:
 * a seed's ancestors (so a fork sees the parent it came from) and its descendants (so a parent
 * sees the whole tree below it), transitively.
 *
 * Nodes the viewer cannot access are included deliberately — a chain broken by one inaccessible
 * link would render as two unrelated trees, and the row is what makes Disconnect reachable when
 * the other side is gone.
 */
async function walkForkGraph(seedIds: string[]): Promise<Map<string, ForestRow>> {
  const nodes = new Map<string, ForestRow>()
  let frontier = seedIds

  for (let hop = 0; hop < MAX_FOREST_HOPS && frontier.length > 0; hop++) {
    const pending = frontier.filter((id) => !nodes.has(id))
    if (pending.length === 0) break

    const rows = await db
      .select(WORKSPACE_COLUMNS)
      .from(workspace)
      .where(and(inArray(workspace.id, pending), isNull(workspace.archivedAt)))
    for (const row of rows) nodes.set(row.id, row)
    if (rows.length === 0 || nodes.size >= MAX_FOREST_NODES) break

    const children = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(
          inArray(
            workspace.forkedFromWorkspaceId,
            rows.map((row) => row.id)
          ),
          isNull(workspace.archivedAt)
        )
      )

    const next = new Set<string>()
    for (const row of rows) {
      if (row.parentId && !nodes.has(row.parentId)) next.add(row.parentId)
    }
    for (const child of children) {
      if (!nodes.has(child.id)) next.add(child.id)
    }
    frontier = Array.from(next)
  }

  return nodes
}

/** Stored-mapping tallies per edge, keyed by the edge's child workspace id. */
async function loadEdgeMappingCounts(
  childIds: string[]
): Promise<Map<string, { mapped: number; unmapped: number }>> {
  if (childIds.length === 0) return new Map()
  const rows = await db
    .select({
      childWorkspaceId: workspaceForkResourceMap.childWorkspaceId,
      mapped: sql<number>`count(*) filter (where ${workspaceForkResourceMap.childResourceId} is not null)`,
      unmapped: sql<number>`count(*) filter (where ${workspaceForkResourceMap.childResourceId} is null)`,
    })
    .from(workspaceForkResourceMap)
    .where(
      and(
        inArray(workspaceForkResourceMap.childWorkspaceId, childIds),
        notInArray(workspaceForkResourceMap.resourceType, [...NON_MAPPABLE_RESOURCE_TYPES])
      )
    )
    .groupBy(workspaceForkResourceMap.childWorkspaceId)

  return new Map(
    rows.map((row) => [
      row.childWorkspaceId,
      { mapped: Number(row.mapped), unmapped: Number(row.unmapped) },
    ])
  )
}

/**
 * The newest promote run per edge and per target, in one read.
 *
 * An edge's runs are exactly the rows carrying its child id (a push from the child targets the
 * parent, a pull into the child targets the child), which is what makes `lastSyncAt` an edge fact
 * while the undo point stays a target fact.
 */
async function loadPromoteRuns(nodeIds: string[]): Promise<{
  lastSyncByChild: Map<string, Date>
  undoByTarget: Map<string, { sourceWorkspaceId: string; direction: 'push' | 'pull' }>
}> {
  const lastSyncByChild = new Map<string, Date>()
  const undoByTarget = new Map<string, { sourceWorkspaceId: string; direction: 'push' | 'pull' }>()
  if (nodeIds.length === 0) return { lastSyncByChild, undoByTarget }

  const rows = await db
    .select({
      childWorkspaceId: workspaceForkPromoteRun.childWorkspaceId,
      targetWorkspaceId: workspaceForkPromoteRun.targetWorkspaceId,
      sourceWorkspaceId: workspaceForkPromoteRun.sourceWorkspaceId,
      direction: workspaceForkPromoteRun.direction,
      createdAt: workspaceForkPromoteRun.createdAt,
    })
    .from(workspaceForkPromoteRun)
    .where(inArray(workspaceForkPromoteRun.childWorkspaceId, nodeIds))
    .orderBy(workspaceForkPromoteRun.createdAt)

  // Ascending order, so each later row simply overwrites — the last write per key wins, which is
  // the newest run for that edge and for that target.
  for (const row of rows) {
    lastSyncByChild.set(row.childWorkspaceId, row.createdAt)
    undoByTarget.set(row.targetWorkspaceId, {
      sourceWorkspaceId: row.sourceWorkspaceId,
      direction: row.direction,
    })
  }
  return { lastSyncByChild, undoByTarget }
}

/** Deployed, unarchived workflow counts per workspace — the only workflows forking ever carries. */
async function loadDeployedWorkflowCounts(nodeIds: string[]): Promise<Map<string, number>> {
  if (nodeIds.length === 0) return new Map()
  const rows = await db
    .select({ workspaceId: workflow.workspaceId, total: sql<number>`count(*)` })
    .from(workflow)
    .where(
      and(
        inArray(workflow.workspaceId, nodeIds),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt)
      )
    )
    .groupBy(workflow.workspaceId)

  return new Map(
    rows.flatMap((row) => (row.workspaceId ? [[row.workspaceId, Number(row.total)]] : []))
  )
}

/** Roots first, then each subtree depth-first, siblings newest-first (matching the fork list). */
function orderDepthFirst(nodes: Map<string, ForestRow>): ForestRow[] {
  const childrenByParent = new Map<string | null, ForestRow[]>()
  for (const node of nodes.values()) {
    // A parent outside the walked set makes this node a root of what the viewer can see.
    const parentKey = node.parentId && nodes.has(node.parentId) ? node.parentId : null
    const siblings = childrenByParent.get(parentKey)
    if (siblings) siblings.push(node)
    else childrenByParent.set(parentKey, [node])
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.name.localeCompare(b.name)
    )
  }

  const ordered: ForestRow[] = []
  const visit = (node: ForestRow) => {
    ordered.push(node)
    for (const child of childrenByParent.get(node.id) ?? []) visit(child)
  }
  for (const root of childrenByParent.get(null) ?? []) visit(root)
  return ordered
}

interface ForkForestParams {
  /** The workspace the console is open in. Always listed, even with no fork edges of its own. */
  anchorWorkspaceId: string
  viewerId: string
  /** Workspaces the viewer administers, seeding the walk. */
  manageableWorkspaceIds: string[]
}

/**
 * Every fork lineage the viewer can reach from the workspace they are standing in, as flat
 * depth-first rows.
 *
 * Seeded from the workspaces the viewer administers rather than from the anchor alone: forking is
 * an admin operation, so those are exactly the trees they can act on, and the console's whole
 * purpose is to show them together instead of one workspace at a time. A workspace with no fork
 * edges is dropped — it has nothing to say on this page — except the anchor, which always appears
 * so the viewer can see where they are standing.
 */
export async function getForkForest(params: ForkForestParams): Promise<ForkForestNode[]> {
  const { anchorWorkspaceId, viewerId, manageableWorkspaceIds } = params

  const seeds = manageableWorkspaceIds.includes(anchorWorkspaceId)
    ? manageableWorkspaceIds
    : [anchorWorkspaceId, ...manageableWorkspaceIds]
  const walked = await walkForkGraph(seeds)

  const parentIds = new Set<string>()
  for (const node of walked.values()) {
    if (node.parentId) parentIds.add(node.parentId)
  }
  // A workspace earns a row by participating in a fork edge — as a child, or as the parent of a
  // node in the walk. The anchor is exempt so the page is never blank for a fork-free workspace.
  for (const [id, node] of walked) {
    if (id === anchorWorkspaceId || node.parentId !== null || parentIds.has(id)) continue
    walked.delete(id)
  }

  const ordered = orderDepthFirst(walked)
  const nodeIds = ordered.map((node) => node.id)
  const childIds = ordered.flatMap((node) => (node.parentId ? [node.id] : []))

  const [mappingCounts, promoteRuns, deployedCounts] = await Promise.all([
    loadEdgeMappingCounts(childIds),
    loadPromoteRuns(nodeIds),
    loadDeployedWorkflowCounts(nodeIds),
  ])

  const manageable = new Set(manageableWorkspaceIds)
  // Admin already implies access, so only the nodes the viewer does NOT administer need a
  // permission read — usually the inaccessible links a chain was widened to include.
  const accessChecks = await Promise.all(
    ordered.map(async (node) => {
      if (manageable.has(node.id)) return true
      const permission = await getEffectiveWorkspacePermission(viewerId, node)
      return permission !== null
    })
  )

  const nameById = new Map(ordered.map((node) => [node.id, node.name]))

  return ordered.map((node, index) => {
    const undo = promoteRuns.undoByTarget.get(node.id)
    const undoableRun: ForkUndoableRun | null = undo
      ? {
          otherWorkspaceId: undo.sourceWorkspaceId,
          otherName: nameById.get(undo.sourceWorkspaceId) ?? 'workspace',
          direction: undo.direction,
        }
      : null
    const counts = mappingCounts.get(node.id) ?? { mapped: 0, unmapped: 0 }
    const lastSync = promoteRuns.lastSyncByChild.get(node.id) ?? null

    return {
      id: node.id,
      name: node.name,
      color: node.color,
      logoUrl: node.logoUrl,
      organizationId: node.organizationId,
      parentId: node.parentId && walked.has(node.parentId) ? node.parentId : null,
      createdAt: node.createdAt.toISOString(),
      viewerAccessible: accessChecks[index],
      viewerCanAdmin: manageable.has(node.id),
      deployedWorkflowCount: deployedCounts.get(node.id) ?? 0,
      edge: node.parentId
        ? {
            mapped: counts.mapped,
            unmapped: counts.unmapped,
            lastSyncAt: lastSync ? lastSync.toISOString() : null,
            undoableRun,
          }
        : null,
    }
  })
}
