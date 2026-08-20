import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { customTools } from '@/db/schema'

const logger = createLogger('CustomToolsAPI')

// Define validation schema for custom tools
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
})

// GET - Fetch all custom tools for the user
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const searchParams = request.nextUrl.searchParams
  const workflowId = searchParams.get('workflowId')

  try {
    let userId: string | undefined

    // If workflowId is provided, get userId from the workflow
    if (workflowId) {
      userId = await getUserId(requestId, workflowId)

      if (!userId) {
        logger.warn(`[${requestId}] No valid user found for workflow: ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else {
      // Otherwise use session-based auth (for client-side)
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized custom tools access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = session.user.id
    }

    const result = await db.select().from(customTools).where(eq(customTools.userId, userId))

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching custom tools:`, error)
    return NextResponse.json({ error: 'Failed to fetch custom tools' }, { status: 500 })
  }
}

// POST - Create or update custom tools
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized custom tools update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      // Validate the request body
      const { tools } = CustomToolSchema.parse(body)

      // Use a transaction for multi-step database operations
      return await db.transaction(async (tx) => {
        // Process each tool: either update existing or create new
        for (const tool of tools) {
          const nowTime = new Date()

          if (tool.id) {
            // First check if this tool belongs to the user
            const existingTool = await tx
              .select()
              .from(customTools)
              .where(eq(customTools.id, tool.id))
              .limit(1)

            if (existingTool.length === 0) {
              // Tool doesn't exist, create it
              await tx.insert(customTools).values({
                id: tool.id,
                userId: session.user.id,
                title: tool.title,
                schema: tool.schema,
                code: tool.code,
                createdAt: nowTime,
                updatedAt: nowTime,
              })
            } else if (existingTool[0].userId === session.user.id) {
              // Tool exists and belongs to user, update it
              await tx
                .update(customTools)
                .set({
                  title: tool.title,
                  schema: tool.schema,
                  code: tool.code,
                  updatedAt: nowTime,
                })
                .where(eq(customTools.id, tool.id))
            } else {
              // Log and silently continue if user attempts to update a tool they don't own
              logger.warn(
                `[${requestId}] Silent continuation on unauthorized tool update attempt: ${tool.id}`
              )
            }
          } else {
            // No ID provided, create a new tool
            await tx.insert(customTools).values({
              id: crypto.randomUUID(),
              userId: session.user.id,
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
              createdAt: nowTime,
              updatedAt: nowTime,
            })
          }
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
  const requestId = crypto.randomUUID().slice(0, 8)
  const searchParams = request.nextUrl.searchParams
  const toolId = searchParams.get('id')

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

    // Check if the tool exists and belongs to the user
    const existingTool = await db
      .select()
      .from(customTools)
      .where(eq(customTools.id, toolId))
      .limit(1)

    if (existingTool.length === 0) {
      logger.warn(`[${requestId}] Tool not found: ${toolId}`)
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    if (existingTool[0].userId !== session.user.id) {
      logger.warn(`[${requestId}] User attempted to delete a tool they don't own: ${toolId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
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
