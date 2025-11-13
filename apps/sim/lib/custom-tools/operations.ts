import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

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

  // Use a transaction for multi-step database operations
  return await db.transaction(async (tx) => {
    // Process each tool: either update existing or create new
    for (const tool of tools) {
      const nowTime = new Date()

      if (tool.id) {
        // First, check if tool exists in the workspace
        const existingWorkspaceTool = await tx
          .select()
          .from(customTools)
          .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
          .limit(1)

        if (existingWorkspaceTool.length > 0) {
          // Tool exists in workspace
          const newFunctionName = tool.schema?.function?.name
          if (!newFunctionName) {
            throw new Error('Tool schema must include a function name')
          }

          // Check if function name has changed
          if (tool.id !== newFunctionName) {
            throw new Error(
              `Cannot change function name from "${tool.id}" to "${newFunctionName}". Please create a new tool instead.`
            )
          }

          // Update existing workspace tool
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

        // Check if this is a legacy tool (no workspaceId, belongs to user)
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
          // Legacy tool found - update it without migrating to workspace
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

      // Creating new tool - use function name as ID for consistency
      const functionName = tool.schema?.function?.name
      if (!functionName) {
        throw new Error('Tool schema must include a function name')
      }

      // Check for duplicate function names in workspace
      const duplicateFunction = await tx
        .select()
        .from(customTools)
        .where(and(eq(customTools.workspaceId, workspaceId), eq(customTools.id, functionName)))
        .limit(1)

      if (duplicateFunction.length > 0) {
        throw new Error(
          `A tool with the function name "${functionName}" already exists in this workspace`
        )
      }

      // Create new tool using function name as ID
      await tx.insert(customTools).values({
        id: functionName,
        workspaceId,
        userId,
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
        createdAt: nowTime,
        updatedAt: nowTime,
      })
    }

    // Fetch and return the created/updated tools
    const resultTools = await tx
      .select()
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .orderBy(desc(customTools.createdAt))

    return resultTools
  })
}
