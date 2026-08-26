import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import {
  type CursorKey,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { generateRequestId } from '@/lib/core/utils/request'
import { assertValidCustomToolDeclaration } from '@/lib/custom-tools/schema'

const logger = createLogger('CustomToolsOperations')

export type CustomToolSortBy = 'title' | 'createdAt' | 'updatedAt'

/**
 * Internal function to create/update custom tools
 * Can be called from API routes or internal services
 */
export async function upsertCustomTools(params: {
  tools: Array<{
    id?: string
    title: string
    schema: any
    code: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
}) {
  const { tools, workspaceId, userId, requestId = generateRequestId() } = params

  /**
   * Ahead of the transaction so a batch is rejected whole rather than landing
   * the tools that preceded the unstorable one.
   */
  for (const tool of tools) {
    assertValidCustomToolDeclaration(tool.schema)
  }

  return await db.transaction(async (tx) => {
    for (const tool of tools) {
      const nowTime = new Date()

      if (tool.id) {
        const existingWorkspaceTool = await tx
          .select()
          .from(customTools)
          .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
          .limit(1)

        if (existingWorkspaceTool.length > 0) {
          await tx
            .update(customTools)
            .set({
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
              updatedAt: nowTime,
            })
            .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
          continue
        }

        const existingLegacyTool = await tx
          .select()
          .from(customTools)
          .where(
            and(
              eq(customTools.id, tool.id),
              isNull(customTools.workspaceId),
              eq(customTools.userId, userId)
            )
          )
          .limit(1)

        if (existingLegacyTool.length > 0) {
          await tx
            .update(customTools)
            .set({
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
              updatedAt: nowTime,
            })
            .where(eq(customTools.id, tool.id))

          logger.info(`[${requestId}] Updated legacy tool ${tool.id}`)
          continue
        }
      }

      const duplicateTitle = await tx
        .select()
        .from(customTools)
        .where(and(eq(customTools.workspaceId, workspaceId), eq(customTools.title, tool.title)))
        .limit(1)

      if (duplicateTitle.length > 0) {
        throw new Error(`A tool with the title "${tool.title}" already exists in this workspace`)
      }

      await tx.insert(customTools).values({
        id: generateShortId(),
        workspaceId,
        userId,
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
        createdAt: nowTime,
        updatedAt: nowTime,
      })
    }

    const resultTools = await tx
      .select()
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .orderBy(desc(customTools.createdAt))

    return resultTools
  })
}

export async function listCustomTools(params: { userId: string; workspaceId?: string }) {
  const { userId, workspaceId } = params
  return workspaceId
    ? db
        .select()
        .from(customTools)
        .where(
          or(
            eq(customTools.workspaceId, workspaceId),
            and(isNull(customTools.workspaceId), eq(customTools.userId, userId))
          )
        )
        .orderBy(desc(customTools.createdAt))
    : db
        .select()
        .from(customTools)
        .where(and(isNull(customTools.workspaceId), eq(customTools.userId, userId)))
        .orderBy(desc(customTools.createdAt))
}

type CustomToolRow = typeof customTools.$inferSelect

const customToolId = textKey<CustomToolRow>(customTools.id, (row) => row.id)

/**
 * Keyset orderings for the public list's sortable fields, made total over the
 * contract enum by `satisfies`. Each ends in `id` so tools sharing a title or a
 * timestamp still come back in a stable order — which is also what makes the
 * cursor resumable, since a non-unique final key can repeat or skip a row at a
 * page boundary.
 */
const CUSTOM_TOOL_SORTS = {
  title: [textKey<CustomToolRow>(customTools.title, (row) => row.title), customToolId],
  createdAt: [
    timestampKey<CustomToolRow>(customTools.createdAt, (row) => row.createdAt),
    customToolId,
  ],
  updatedAt: [
    timestampKey<CustomToolRow>(customTools.updatedAt, (row) => row.updatedAt),
    customToolId,
  ],
} satisfies Record<CustomToolSortBy, readonly KeysetKey<CustomToolRow>[]>

/**
 * Workspace-scoped reads and deletes.
 *
 * The functions above tolerate legacy personal tools (`workspace_id IS NULL`,
 * owned by one user) alongside workspace ones. The public API is workspace-
 * scoped in every direction, so it uses these instead — a caller holding a
 * workspace key must never reach another user's personal tool.
 */
export async function listWorkspaceCustomTools(params: {
  workspaceId: string
  /** Case-insensitive substring match on the tool title. */
  search?: string
  sortBy?: CustomToolSortBy
  sortOrder?: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}) {
  const { sortBy = 'createdAt', sortOrder = 'desc', limit } = params
  const keys = CUSTOM_TOOL_SORTS[sortBy]
  const resumeAfter = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const rows = await db
    .select()
    .from(customTools)
    .where(
      and(
        eq(customTools.workspaceId, params.workspaceId),
        searchFilter(customTools.title, params.search),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))
    .limit(limit + 1)

  return keysetPage(keys, rows, limit)
}

export async function getWorkspaceCustomTool(params: { workspaceId: string; toolId: string }) {
  const [row] = await db
    .select()
    .from(customTools)
    .where(and(eq(customTools.id, params.toolId), eq(customTools.workspaceId, params.workspaceId)))
    .limit(1)
  return row ?? null
}

/** Titles are unique per workspace (`custom_tools_workspace_title_unique`). */
export async function getWorkspaceCustomToolByTitle(params: {
  workspaceId: string
  title: string
}) {
  const [row] = await db
    .select()
    .from(customTools)
    .where(
      and(eq(customTools.workspaceId, params.workspaceId), eq(customTools.title, params.title))
    )
    .limit(1)
  return row ?? null
}

/**
 * Updates a workspace tool in place, returning the updated row or null when the
 * id no longer resolves in that workspace.
 *
 * Deliberately not `upsertCustomTools`: that treats an unresolvable id as a
 * create and inserts under a *new* id, so a tool deleted concurrently with an
 * edit would be silently re-created as an orphan under a different id while the
 * caller's follow-up read of the original id 404s.
 */
export async function updateWorkspaceCustomTool(params: {
  workspaceId: string
  toolId: string
  title: string
  schema: unknown
  code: string
}) {
  const [row] = await db
    .update(customTools)
    .set({
      title: params.title,
      schema: params.schema,
      code: params.code,
      updatedAt: new Date(),
    })
    .where(and(eq(customTools.id, params.toolId), eq(customTools.workspaceId, params.workspaceId)))
    .returning()
  return row ?? null
}

export async function deleteWorkspaceCustomTool(params: {
  workspaceId: string
  toolId: string
}): Promise<boolean> {
  const deleted = await db
    .delete(customTools)
    .where(and(eq(customTools.id, params.toolId), eq(customTools.workspaceId, params.workspaceId)))
    .returning({ id: customTools.id })
  return deleted.length > 0
}

export async function getCustomToolById(params: {
  toolId: string
  userId: string
  workspaceId?: string
}) {
  const { toolId, userId, workspaceId } = params

  if (workspaceId) {
    const workspaceTool = await db
      .select()
      .from(customTools)
      .where(and(eq(customTools.id, toolId), eq(customTools.workspaceId, workspaceId)))
      .limit(1)
    if (workspaceTool[0]) return workspaceTool[0]
  }

  const legacyTool = await db
    .select()
    .from(customTools)
    .where(
      and(
        eq(customTools.id, toolId),
        isNull(customTools.workspaceId),
        eq(customTools.userId, userId)
      )
    )
    .limit(1)
  return legacyTool[0] || null
}

export async function getCustomToolByIdOrTitle(params: {
  identifier: string
  userId: string
  workspaceId?: string
}) {
  const { identifier, userId, workspaceId } = params

  const conditions = [or(eq(customTools.id, identifier), eq(customTools.title, identifier))]

  if (workspaceId) {
    const workspaceTool = await db
      .select()
      .from(customTools)
      .where(and(eq(customTools.workspaceId, workspaceId), ...conditions))
      .limit(1)
    if (workspaceTool[0]) return workspaceTool[0]
  }

  const legacyTool = await db
    .select()
    .from(customTools)
    .where(and(isNull(customTools.workspaceId), eq(customTools.userId, userId), ...conditions))
    .limit(1)
  return legacyTool[0] || null
}

export async function updateCustomTool(params: {
  toolId: string
  userId: string
  workspaceId: string
  title: string
  schema: unknown
  code: string
}) {
  const workspaceTool = await updateWorkspaceCustomTool(params)
  if (workspaceTool) return workspaceTool

  const [legacyTool] = await db
    .update(customTools)
    .set({
      title: params.title,
      schema: params.schema,
      code: params.code,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customTools.id, params.toolId),
        isNull(customTools.workspaceId),
        eq(customTools.userId, params.userId)
      )
    )
    .returning()
  return legacyTool ?? null
}

export async function deleteCustomTool(params: {
  toolId: string
  userId: string
  workspaceId?: string
}): Promise<boolean> {
  const { toolId, userId, workspaceId } = params

  if (workspaceId) {
    const workspaceDelete = await db
      .delete(customTools)
      .where(and(eq(customTools.id, toolId), eq(customTools.workspaceId, workspaceId)))
      .returning({ id: customTools.id })
    if (workspaceDelete.length > 0) return true
  }

  const legacyDelete = await db
    .delete(customTools)
    .where(
      and(
        eq(customTools.id, toolId),
        isNull(customTools.workspaceId),
        eq(customTools.userId, userId)
      )
    )
    .returning({ id: customTools.id })
  return legacyDelete.length > 0
}
