import { db } from '@sim/db'
import { customTools, workflow } from '@sim/db/schema'
import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('CustomToolsAPI')

const CustomToolSchema = z.object({
  tools: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1, 'Tool title is required'),
      schema: z.object({
        type: z.literal('function'),
        function: z.object({
          name: z.string().min(1, 'Function name is required'),
          description: z.string().optional(),
          parameters: z.object({
            type: z.string(),
            properties: z.record(z.any()),
            required: z.array(z.string()).optional(),
          }),
        }),
      }),
      code: z.string(),
    })
  ),
  workspaceId: z.string().optional(),
})

// GET - Fetch all custom tools for the workspace
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get('workspaceId')
  const workflowId = searchParams.get('workflowId')

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized custom tools access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let resolvedWorkspaceId: string | null = workspaceId

    // If workflowId is provided, get workspaceId from the workflow
    if (!resolvedWorkspaceId && workflowId) {
      const [workflowData] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      resolvedWorkspaceId = workflowData.workspaceId
    }

    if (!resolvedWorkspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId parameter`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    // Check workspace permissions
    const userPermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      resolvedWorkspaceId
    )
    if (!userPermission) {
      logger.warn(
        `[${requestId}] User ${session.user.id} does not have access to workspace ${resolvedWorkspaceId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Fetch workspace-scoped tools AND user-scoped tools (for backward compatibility)
    const result = await db
      .select()
      .from(customTools)
      .where(
        and(
          or(
            eq(customTools.workspaceId, resolvedWorkspaceId),
            and(isNull(customTools.workspaceId), eq(customTools.userId, session.user.id))
          )
        )
      )

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching custom tools:`, error)
    return NextResponse.json({ error: 'Failed to fetch custom tools' }, { status: 500 })
  }
}

// POST - Create or update custom tools
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized custom tools update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      // Validate the request body
      const { tools, workspaceId } = CustomToolSchema.parse(body)

      if (!workspaceId) {
        logger.warn(`[${requestId}] Missing workspaceId in request body`)
        return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
      }

      // Check workspace permissions
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      if (!userPermission) {
        logger.warn(
          `[${requestId}] User ${session.user.id} does not have access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      // Check write permission
      if (userPermission !== 'admin' && userPermission !== 'write') {
        logger.warn(
          `[${requestId}] User ${session.user.id} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      // Use a transaction for multi-step database operations
      return await db.transaction(async (tx) => {
        // Process each tool: either update existing or create new
        for (const tool of tools) {
          const nowTime = new Date()

          if (tool.id) {
            // Check if tool exists and belongs to the workspace
            const existingTool = await tx
              .select()
              .from(customTools)
              .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
              .limit(1)

            if (existingTool.length > 0) {
              // Tool exists - check if name changed and if new name conflicts
              if (existingTool[0].title !== tool.title) {
                // Check for duplicate name in workspace (excluding current tool)
                const duplicateTool = await tx
                  .select()
                  .from(customTools)
                  .where(
                    and(
                      eq(customTools.workspaceId, workspaceId),
                      eq(customTools.title, tool.title),
                      ne(customTools.id, tool.id)
                    )
                  )
                  .limit(1)

                if (duplicateTool.length > 0) {
                  return NextResponse.json(
                    {
                      error: `A tool with the name "${tool.title}" already exists in this workspace`,
                    },
                    { status: 400 }
                  )
                }
              }

              // Update existing tool
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
          }

          // Creating new tool - check for duplicate names in workspace
          const duplicateTool = await tx
            .select()
            .from(customTools)
            .where(and(eq(customTools.workspaceId, workspaceId), eq(customTools.title, tool.title)))
            .limit(1)

          if (duplicateTool.length > 0) {
            return NextResponse.json(
              { error: `A tool with the name "${tool.title}" already exists in this workspace` },
              { status: 400 }
            )
          }

          // Create new tool
          await tx.insert(customTools).values({
            id: tool.id || crypto.randomUUID(),
            workspaceId,
            userId: session.user.id,
            title: tool.title,
            schema: tool.schema,
            code: tool.code,
            createdAt: nowTime,
            updatedAt: nowTime,
          })
        }

        return NextResponse.json({ success: true })
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid custom tools data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating custom tools`, error)
    return NextResponse.json({ error: 'Failed to update custom tools' }, { status: 500 })
  }
}

// DELETE - Delete a custom tool by ID
export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const toolId = searchParams.get('id')
  const workspaceId = searchParams.get('workspaceId')

  if (!toolId) {
    logger.warn(`[${requestId}] Missing tool ID for deletion`)
    return NextResponse.json({ error: 'Tool ID is required' }, { status: 400 })
  }

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized custom tool deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if the tool exists
    const existingTool = await db
      .select()
      .from(customTools)
      .where(eq(customTools.id, toolId))
      .limit(1)

    if (existingTool.length === 0) {
      logger.warn(`[${requestId}] Tool not found: ${toolId}`)
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    const tool = existingTool[0]

    // Handle workspace-scoped tools
    if (tool.workspaceId) {
      if (!workspaceId) {
        logger.warn(`[${requestId}] Missing workspaceId for workspace-scoped tool`)
        return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
      }

      // Check workspace permissions
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      if (!userPermission) {
        logger.warn(
          `[${requestId}] User ${session.user.id} does not have access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      // Check write permission
      if (userPermission !== 'admin' && userPermission !== 'write') {
        logger.warn(
          `[${requestId}] User ${session.user.id} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      // Verify tool belongs to this workspace
      if (tool.workspaceId !== workspaceId) {
        logger.warn(`[${requestId}] Tool ${toolId} does not belong to workspace ${workspaceId}`)
        return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
      }
    } else {
      // Handle user-scoped tools (legacy, no workspaceId)
      // Only allow deletion if user owns the tool
      if (tool.userId !== session.user.id) {
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted to delete tool they don't own: ${toolId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // Delete the tool
    await db.delete(customTools).where(eq(customTools.id, toolId))

    logger.info(`[${requestId}] Deleted tool: ${toolId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting custom tool:`, error)
    return NextResponse.json({ error: 'Failed to delete custom tool' }, { status: 500 })
  }
}
