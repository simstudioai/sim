import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import { generateShortId } from '@/lib/core/utils/uuid'

const logger = createLogger('CustomToolsOperations')

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
