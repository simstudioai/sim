import { db } from '@sim/db'
import {
  customTools,
  document,
  embedding,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  userTableRows,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { generateMcpServerId } from '@/lib/mcp/utils'
import type { TableSchema } from '@/lib/table/types'
import type {
  ForkMappingUpsert,
  ForkResourceType,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import { remapForkTableWorkflowGroups } from '@/lib/workspaces/fork/remap/remap-table-groups'

const logger = createLogger('WorkspaceForkCopyResources')

/** Page size for the post-transaction bulk content copy (keyset-paginated). */
const CONTENT_PAGE = 500

export interface CopyResourcesParams {
  tx: DbOrTx
  sourceWorkspaceId: string
  childWorkspaceId: string
  userId: string
  now: Date
  /** Source resource ids selected for copy, by kind. */
  selection: {
    customTools: string[]
    skills: string[]
    mcpServers: string[]
    tables: string[]
    knowledgeBases: string[]
  }
  /** source workflow id -> child workflow id, for table workflow-group remap. */
  workflowIdMap: Map<string, string>
}

export interface ForkContentPlanEntry {
  sourceId: string
  childId: string
}

/** Bulk content to copy AFTER the fork transaction commits (best-effort, batched). */
export interface ForkContentPlan {
  sourceWorkspaceId: string
  childWorkspaceId: string
  tables: ForkContentPlanEntry[]
  knowledgeBases: ForkContentPlanEntry[]
}

export interface CopyResourcesResult {
  /** source resource id -> child resource id, keyed by fork resource type. */
  idMap: Map<ForkResourceType, Map<string, string>>
  /** Identity mapping rows to persist for every copied resource. */
  mappingEntries: ForkMappingUpsert[]
  /** Heavy row/document/embedding content to copy post-commit. */
  contentPlan: ForkContentPlan
}

function setId(idMap: Map<ForkResourceType, Map<string, string>>, type: ForkResourceType) {
  let map = idMap.get(type)
  if (!map) {
    map = new Map()
    idMap.set(type, map)
  }
  return map
}

/**
 * Copy the selected resources' **container rows** into the child workspace inside
 * the fork transaction: custom tools, skills, and MCP server configs (each a
 * single row), plus table definitions and knowledge-base rows (without their bulk
 * rows / documents / embeddings). This keeps the fork transaction bounded to
 * O(selected resources) single-row writes. The heavy content (table rows, KB
 * documents + embeddings) is returned as a {@link ForkContentPlan} for
 * {@link copyForkResourceContent} to copy best-effort after commit. Secrets are
 * never copied: MCP OAuth tokens are omitted (re-auth required) and KB connectors
 * are not copied (the child is a content snapshot without live sync).
 */
export async function copyForkResourceContainers(
  params: CopyResourcesParams
): Promise<CopyResourcesResult> {
  const { tx, sourceWorkspaceId, childWorkspaceId, userId, now, selection, workflowIdMap } = params
  const idMap = new Map<ForkResourceType, Map<string, string>>()
  const mappingEntries: ForkMappingUpsert[] = []
  const contentPlan: ForkContentPlan = {
    sourceWorkspaceId,
    childWorkspaceId,
    tables: [],
    knowledgeBases: [],
  }

  const record = (type: ForkResourceType, sourceId: string, childId: string) => {
    setId(idMap, type).set(sourceId, childId)
    mappingEntries.push({
      resourceType: type,
      parentResourceId: sourceId,
      childResourceId: childId,
    })
  }

  if (selection.customTools.length > 0) {
    const rows = await tx
      .select()
      .from(customTools)
      .where(
        and(
          inArray(customTools.id, selection.customTools),
          eq(customTools.workspaceId, sourceWorkspaceId)
        )
      )
    for (const row of rows) {
      const childId = generateId()
      await tx.insert(customTools).values({
        ...row,
        id: childId,
        workspaceId: childWorkspaceId,
        userId,
        createdAt: now,
        updatedAt: now,
      })
      record('custom_tool', row.id, childId)
    }
  }

  if (selection.skills.length > 0) {
    const rows = await tx
      .select()
      .from(skill)
      .where(and(inArray(skill.id, selection.skills), eq(skill.workspaceId, sourceWorkspaceId)))
    for (const row of rows) {
      const childId = generateId()
      await tx.insert(skill).values({
        ...row,
        id: childId,
        workspaceId: childWorkspaceId,
        userId,
        createdAt: now,
        updatedAt: now,
      })
      record('skill', row.id, childId)
    }
  }

  if (selection.mcpServers.length > 0) {
    const rows = await tx
      .select()
      .from(mcpServers)
      .where(
        and(
          inArray(mcpServers.id, selection.mcpServers),
          eq(mcpServers.workspaceId, sourceWorkspaceId)
        )
      )
    // `generateMcpServerId` is deterministic on (workspace, url), so two selected
    // servers with the same normalized URL derive the same child id. Insert once
    // and map both source ids to the surviving child rather than aborting the fork.
    const insertedMcpIds = new Set<string>()
    for (const row of rows) {
      const childId = row.url ? generateMcpServerId(childWorkspaceId, row.url) : generateId()
      record('mcp_server', row.id, childId)
      if (insertedMcpIds.has(childId)) continue
      insertedMcpIds.add(childId)
      await tx
        .insert(mcpServers)
        .values({
          ...row,
          id: childId,
          workspaceId: childWorkspaceId,
          createdBy: userId,
          // Secrets are never copied across workspaces: drop the registered OAuth
          // client + any auth headers so the child re-authenticates from scratch.
          oauthClientId: null,
          oauthClientSecret: null,
          headers: {},
          connectionStatus: 'disconnected',
          lastConnected: null,
          lastError: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
    }
  }

  if (selection.tables.length > 0) {
    const definitions = await tx
      .select()
      .from(userTableDefinitions)
      .where(
        and(
          inArray(userTableDefinitions.id, selection.tables),
          eq(userTableDefinitions.workspaceId, sourceWorkspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      )
    for (const definition of definitions) {
      const childTableId = generateId()
      const remappedSchema = remapForkTableWorkflowGroups(
        definition.schema as TableSchema,
        workflowIdMap
      )
      await tx.insert(userTableDefinitions).values({
        ...definition,
        id: childTableId,
        workspaceId: childWorkspaceId,
        schema: remappedSchema,
        createdBy: userId,
        rowsVersion: 0,
        // Start at 0 - the post-commit content copy raises it to the rows actually
        // copied, so a failed/partial copy never advertises the source's count.
        rowCount: 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      record('table', definition.id, childTableId)
      contentPlan.tables.push({ sourceId: definition.id, childId: childTableId })
    }
  }

  if (selection.knowledgeBases.length > 0) {
    const bases = await tx
      .select()
      .from(knowledgeBase)
      .where(
        and(
          inArray(knowledgeBase.id, selection.knowledgeBases),
          eq(knowledgeBase.workspaceId, sourceWorkspaceId),
          isNull(knowledgeBase.deletedAt)
        )
      )
    for (const base of bases) {
      const childKbId = generateId()
      await tx.insert(knowledgeBase).values({
        ...base,
        id: childKbId,
        workspaceId: childWorkspaceId,
        userId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      record('knowledge_base', base.id, childKbId)
      contentPlan.knowledgeBases.push({ sourceId: base.id, childId: childKbId })
    }
  }

  return { idMap, mappingEntries, contentPlan }
}

/**
 * Copy the heavy resource content described by a {@link ForkContentPlan} AFTER the
 * fork transaction has committed: table rows, and KB documents + embeddings. Reads
 * and writes are keyset-paginated so peak memory is bounded to one page, and each
 * resource is copied in its own short statements (never one long transaction).
 * Best-effort: a failure on one resource is logged and the others continue - the
 * fork itself (workflows + container rows) already succeeded.
 */
export async function copyForkResourceContent(params: {
  contentPlan: ForkContentPlan
  requestId?: string
}): Promise<void> {
  const { contentPlan, requestId = 'unknown' } = params
  const { childWorkspaceId } = contentPlan

  for (const table of contentPlan.tables) {
    try {
      let copied = 0
      let afterId: string | null = null
      for (;;) {
        const where: SQL<unknown> | undefined =
          afterId === null
            ? eq(userTableRows.tableId, table.sourceId)
            : and(eq(userTableRows.tableId, table.sourceId), gt(userTableRows.id, afterId))
        const rows = await db
          .select()
          .from(userTableRows)
          .where(where)
          .orderBy(asc(userTableRows.id))
          .limit(CONTENT_PAGE)
        if (rows.length === 0) break
        await db.insert(userTableRows).values(
          rows.map((row) => ({
            ...row,
            id: generateId(),
            tableId: table.childId,
            workspaceId: childWorkspaceId,
          }))
        )
        copied += rows.length
        afterId = rows[rows.length - 1].id
        if (rows.length < CONTENT_PAGE) break
      }
      await db
        .update(userTableDefinitions)
        .set({ rowCount: copied })
        .where(eq(userTableDefinitions.id, table.childId))
    } catch (error) {
      logger.warn(`[${requestId}] Failed to copy table rows during fork`, {
        sourceTableId: table.sourceId,
        error: getErrorMessage(error),
      })
    }
  }

  for (const kb of contentPlan.knowledgeBases) {
    try {
      let afterDocId: string | null = null
      for (;;) {
        const where: SQL<unknown> | undefined =
          afterDocId === null
            ? eq(document.knowledgeBaseId, kb.sourceId)
            : and(eq(document.knowledgeBaseId, kb.sourceId), gt(document.id, afterDocId))
        const docs = await db
          .select()
          .from(document)
          .where(where)
          .orderBy(asc(document.id))
          .limit(CONTENT_PAGE)
        if (docs.length === 0) break
        for (const doc of docs) {
          const childDocId = generateId()
          await db
            .insert(document)
            .values({ ...doc, id: childDocId, knowledgeBaseId: kb.childId, connectorId: null })
          await copyDocumentEmbeddings(doc.id, childDocId, kb.childId)
        }
        afterDocId = docs[docs.length - 1].id
        if (docs.length < CONTENT_PAGE) break
      }
    } catch (error) {
      logger.warn(`[${requestId}] Failed to copy knowledge base content during fork`, {
        sourceKnowledgeBaseId: kb.sourceId,
        error: getErrorMessage(error),
      })
    }
  }
}

async function copyDocumentEmbeddings(
  sourceDocumentId: string,
  childDocumentId: string,
  childKnowledgeBaseId: string
): Promise<void> {
  let afterId: string | null = null
  for (;;) {
    const where: SQL<unknown> | undefined =
      afterId === null
        ? eq(embedding.documentId, sourceDocumentId)
        : and(eq(embedding.documentId, sourceDocumentId), gt(embedding.id, afterId))
    const rows = await db
      .select()
      .from(embedding)
      .where(where)
      .orderBy(asc(embedding.id))
      .limit(CONTENT_PAGE)
    if (rows.length === 0) break
    await db.insert(embedding).values(
      rows.map((row) => ({
        ...row,
        id: generateId(),
        documentId: childDocumentId,
        knowledgeBaseId: childKnowledgeBaseId,
      }))
    )
    afterId = rows[rows.length - 1].id
    if (rows.length < CONTENT_PAGE) break
  }
}
