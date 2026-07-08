import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { acquireWorkflowMcpServerLock } from '@/lib/mcp/server-locks'
import { validateMcpToolMetadataForStorage } from '@/lib/mcp/tool-limits'
import { getEdgeMappingRows } from '@/lib/workspaces/fork/mapping/mapping-store'

/**
 * The seed `parameterSchema` for a copied attachment. The source's schema is copied so the tool
 * serves correctly before the target's first deploy, UNLESS it exceeds the per-tool storage
 * limit - then the empty schema is seeded instead (the same degradation the deploy-time sync
 * applies) and the deployment outbox re-derives the real one when the target deploys.
 */
function seedParameterSchema(parameterSchema: unknown): unknown {
  const invalid = validateMcpToolMetadataForStorage({
    parameterSchema: parameterSchema as Record<string, unknown>,
  })
  return invalid ? { type: 'object', properties: {} } : parameterSchema
}

export interface ForkMcpAttachmentPair {
  sourceWorkflowId: string
  targetWorkflowId: string
}

/**
 * Copy `workflow_mcp_tool` attachments into a fresh fork: every source attachment whose server
 * AND workflow were both copied gets a child row (fresh id; metadata + schema copied - the child
 * re-derives the schema when it first deploys). Insert-only: the child is brand new, so there is
 * nothing to update or archive, and no server locks are needed (the child's servers are
 * invisible until the fork transaction commits). Must run AFTER the child workflow rows exist
 * (FK). A no-op when either map is empty.
 */
export async function copyForkWorkflowMcpAttachments(params: {
  tx: DbOrTx
  /** Source workflow-publishing server id -> child copy id. */
  serverIdMap: ReadonlyMap<string, string>
  /** Source workflow id -> child workflow id. */
  workflowIdMap: ReadonlyMap<string, string>
  now: Date
}): Promise<{ copied: number }> {
  const { tx, serverIdMap, workflowIdMap, now } = params
  if (serverIdMap.size === 0 || workflowIdMap.size === 0) return { copied: 0 }

  const sourceAttachments = await tx
    .select({
      serverId: workflowMcpTool.serverId,
      workflowId: workflowMcpTool.workflowId,
      toolName: workflowMcpTool.toolName,
      toolDescription: workflowMcpTool.toolDescription,
      parameterSchema: workflowMcpTool.parameterSchema,
      parameterDescriptionOverrides: workflowMcpTool.parameterDescriptionOverrides,
    })
    .from(workflowMcpTool)
    .where(
      and(
        inArray(workflowMcpTool.serverId, [...serverIdMap.keys()]),
        inArray(workflowMcpTool.workflowId, [...workflowIdMap.keys()]),
        isNull(workflowMcpTool.archivedAt)
      )
    )

  const inserts: (typeof workflowMcpTool.$inferInsert)[] = []
  for (const attachment of sourceAttachments) {
    const childServerId = serverIdMap.get(attachment.serverId)
    const childWorkflowId = workflowIdMap.get(attachment.workflowId)
    if (!childServerId || !childWorkflowId) continue
    inserts.push({
      id: generateId(),
      serverId: childServerId,
      workflowId: childWorkflowId,
      toolName: attachment.toolName,
      toolDescription: attachment.toolDescription,
      parameterSchema: seedParameterSchema(attachment.parameterSchema),
      parameterDescriptionOverrides: attachment.parameterDescriptionOverrides,
      createdAt: now,
      updatedAt: now,
    })
  }
  if (inserts.length > 0) await tx.insert(workflowMcpTool).values(inserts)
  return { copied: inserts.length }
}

/**
 * Mirror `workflow_mcp_tool` attachments (a workflow exposed as a tool on a
 * workflow-publishing MCP server) onto the target side of a sync, through the edge's
 * `workflow_mcp_server` identity map (seeded when a fork copies the server shells).
 *
 * For each written workflow pair whose source is attached to a MAPPED server:
 *  - a missing target attachment is created (metadata copied; `parameterSchema` is copied as a
 *    seed and re-derived by the deployment outbox when the target deploys),
 *  - an existing one has its user-set metadata (tool name / description / description
 *    overrides) refreshed to the source's,
 *  - a target attachment on a mapped server + synced workflow with NO source counterpart is
 *    archived (the source detached it) - target attachments on unmapped servers or unsynced
 *    workflows are never touched.
 *
 * Unmapped servers are skipped entirely: attachment sync follows the server identity, exactly
 * like subblock references follow resource mappings. Bounded by (written workflows x mapped
 * servers); acquires the same per-server advisory locks the deploy-time tool sync takes.
 * Returns the affected target server ids so the caller can notify them post-commit.
 */
export async function reconcileForkWorkflowMcpAttachments(params: {
  tx: DbOrTx
  childWorkspaceId: string
  /** True when the sync SOURCE is the parent workspace (a pull). */
  sourceIsParent: boolean
  now: Date
  /** The workflow pairs THIS sync wrote (replace + create). */
  writtenPairs: ForkMcpAttachmentPair[]
}): Promise<{ affectedServerIds: string[] }> {
  const { tx, childWorkspaceId, sourceIsParent, now, writtenPairs } = params
  if (writtenPairs.length === 0) return { affectedServerIds: [] }

  const mappingRows = await getEdgeMappingRows(tx, childWorkspaceId)
  const serverMap = new Map<string, string>()
  for (const row of mappingRows) {
    if (row.resourceType !== 'workflow_mcp_server' || row.childResourceId == null) continue
    if (sourceIsParent) serverMap.set(row.parentResourceId, row.childResourceId)
    else serverMap.set(row.childResourceId, row.parentResourceId)
  }
  if (serverMap.size === 0) return { affectedServerIds: [] }

  // Liveness guard: a mapped server may have been deleted since the fork (server deletion is a
  // hard delete that cascades its tools but leaves the identity row). A dead SOURCE server has
  // nothing to mirror; a dead TARGET server must be skipped or the insert below would violate
  // the `server_id` FK and abort the whole promote transaction.
  const mappedServerIds = [...new Set([...serverMap.keys(), ...serverMap.values()])]
  const liveServerIds = new Set(
    (
      await tx
        .select({ id: workflowMcpServer.id })
        .from(workflowMcpServer)
        .where(
          and(inArray(workflowMcpServer.id, mappedServerIds), isNull(workflowMcpServer.deletedAt))
        )
    ).map((row) => row.id)
  )
  for (const [sourceServerId, targetServerId] of serverMap) {
    if (!liveServerIds.has(sourceServerId) || !liveServerIds.has(targetServerId)) {
      serverMap.delete(sourceServerId)
    }
  }
  if (serverMap.size === 0) return { affectedServerIds: [] }

  const targetBySource = new Map(
    writtenPairs.map((pair) => [pair.sourceWorkflowId, pair.targetWorkflowId])
  )
  const sourceAttachments = await tx
    .select({
      serverId: workflowMcpTool.serverId,
      workflowId: workflowMcpTool.workflowId,
      toolName: workflowMcpTool.toolName,
      toolDescription: workflowMcpTool.toolDescription,
      parameterSchema: workflowMcpTool.parameterSchema,
      parameterDescriptionOverrides: workflowMcpTool.parameterDescriptionOverrides,
    })
    .from(workflowMcpTool)
    .where(
      and(
        inArray(workflowMcpTool.workflowId, [...targetBySource.keys()]),
        inArray(workflowMcpTool.serverId, [...serverMap.keys()]),
        isNull(workflowMcpTool.archivedAt)
      )
    )

  /** Desired live target pairs, keyed `${targetServerId}\u0000${targetWorkflowId}`. */
  const desired = new Map<
    string,
    {
      serverId: string
      workflowId: string
      toolName: string
      toolDescription: string | null
      parameterSchema: unknown
      parameterDescriptionOverrides: Record<string, string>
    }
  >()
  for (const attachment of sourceAttachments) {
    const targetServerId = serverMap.get(attachment.serverId)
    const targetWorkflowId = targetBySource.get(attachment.workflowId)
    if (!targetServerId || !targetWorkflowId) continue
    desired.set(`${targetServerId}\u0000${targetWorkflowId}`, {
      serverId: targetServerId,
      workflowId: targetWorkflowId,
      toolName: attachment.toolName,
      toolDescription: attachment.toolDescription,
      parameterSchema: attachment.parameterSchema,
      parameterDescriptionOverrides: attachment.parameterDescriptionOverrides,
    })
  }

  // The reconcile scope: every mapped TARGET server x every synced TARGET workflow. Rows
  // outside this product are never touched.
  const mappedTargetServerIds = [...new Set(serverMap.values())].sort()
  const syncedTargetWorkflowIds = [...new Set(targetBySource.values())]
  const existing = await tx
    .select({
      id: workflowMcpTool.id,
      serverId: workflowMcpTool.serverId,
      workflowId: workflowMcpTool.workflowId,
      toolName: workflowMcpTool.toolName,
      toolDescription: workflowMcpTool.toolDescription,
      parameterDescriptionOverrides: workflowMcpTool.parameterDescriptionOverrides,
    })
    .from(workflowMcpTool)
    .where(
      and(
        inArray(workflowMcpTool.serverId, mappedTargetServerIds),
        inArray(workflowMcpTool.workflowId, syncedTargetWorkflowIds),
        isNull(workflowMcpTool.archivedAt)
      )
    )
  const existingByKey = new Map(
    existing.map((row) => [`${row.serverId}\u0000${row.workflowId}`, row])
  )

  const inserts: (typeof workflowMcpTool.$inferInsert)[] = []
  const updates: Array<{ id: string; set: Partial<typeof workflowMcpTool.$inferInsert> }> = []
  const archiveIds: string[] = []
  const affectedServerIds = new Set<string>()

  for (const [key, want] of desired) {
    const current = existingByKey.get(key)
    if (!current) {
      inserts.push({
        id: generateId(),
        serverId: want.serverId,
        workflowId: want.workflowId,
        toolName: want.toolName,
        toolDescription: want.toolDescription,
        // Seed with the source's schema; the deployment outbox re-derives it from the
        // target's deployed state right after this sync deploys the workflow.
        parameterSchema: seedParameterSchema(want.parameterSchema),
        parameterDescriptionOverrides: want.parameterDescriptionOverrides,
        createdAt: now,
        updatedAt: now,
      })
      affectedServerIds.add(want.serverId)
      continue
    }
    const overridesChanged =
      JSON.stringify(current.parameterDescriptionOverrides ?? {}) !==
      JSON.stringify(want.parameterDescriptionOverrides ?? {})
    if (
      current.toolName !== want.toolName ||
      current.toolDescription !== want.toolDescription ||
      overridesChanged
    ) {
      updates.push({
        id: current.id,
        set: {
          toolName: want.toolName,
          toolDescription: want.toolDescription,
          parameterDescriptionOverrides: want.parameterDescriptionOverrides,
          updatedAt: now,
        },
      })
      affectedServerIds.add(current.serverId)
    }
  }
  for (const [key, row] of existingByKey) {
    if (desired.has(key)) continue
    archiveIds.push(row.id)
    affectedServerIds.add(row.serverId)
  }

  if (inserts.length === 0 && updates.length === 0 && archiveIds.length === 0) {
    return { affectedServerIds: [] }
  }

  // Same per-server serialization as the deploy-time tool sync, in sorted order so two
  // concurrent syncs can't deadlock on each other's server locks.
  for (const serverId of [...affectedServerIds].sort()) {
    await acquireWorkflowMcpServerLock(tx, serverId)
  }

  if (inserts.length > 0) await tx.insert(workflowMcpTool).values(inserts)
  for (const update of updates) {
    await tx.update(workflowMcpTool).set(update.set).where(eq(workflowMcpTool.id, update.id))
  }
  if (archiveIds.length > 0) {
    await tx
      .update(workflowMcpTool)
      .set({ archivedAt: now, updatedAt: now })
      .where(inArray(workflowMcpTool.id, archiveIds))
  }

  return { affectedServerIds: [...affectedServerIds] }
}
