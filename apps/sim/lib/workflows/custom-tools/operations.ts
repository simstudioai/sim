import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { generateRequestId } from '@/lib/core/utils/request'

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
        id: nanoid(),
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
