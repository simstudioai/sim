import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { templates, user, workflow } from '@/db/schema'

// Create a logger for this module
const logger = createLogger('TemplatesPublishAPI')

// No cache
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Schema for request body
const PublishRequestSchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(3).max(50).optional(),
  shortDescription: z.string().min(10).max(200).optional(),
  longDescription: z.string().min(20).max(1000).optional(),
  category: z.string().min(1).optional(),
  authorName: z.string().min(2).max(50).optional(),
  workflowState: z.record(z.any()).optional(),
})

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized templates publish attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      // Parse request body
      const body = await request.json()
      const {
        workflowId,
        name,
        shortDescription,
        longDescription,
        category,
        authorName,
        workflowState,
      } = PublishRequestSchema.parse(body)

      // Check if the workflow belongs to the user
      const userWorkflow = await db
        .select({ id: workflow.id, name: workflow.name, description: workflow.description })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!userWorkflow.length || userWorkflow[0].id !== workflowId) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to publish templates they don't own: ${workflowId}`
        )
        return NextResponse.json({ error: 'Templates not found' }, { status: 404 })
      }

      // Get the user's name for attribution
      const userData = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      if (!userData.length) {
        logger.error(`[${requestId}] User data not found for ID: ${userId}`)
        return NextResponse.json({ error: 'User data not found' }, { status: 500 })
      }

      // Verify we have the workflow state
      if (!workflowState) {
        logger.error(`[${requestId}] No templates state provided for ID: ${workflowId}`)
        return NextResponse.json({ error: 'Templates state is required' }, { status: 400 })
      }

      // Check if this templates is already published
      const existingPublication = await db
        .select({ id: templates.id })
        .from(templates)
        .where(eq(templates.workflowId, workflowId))
        .limit(1)

      let result
      const templatesId = existingPublication.length ? existingPublication[0].id : uuidv4()

      // Prepare the templates entry
      const templatesEntry = {
        id: templatesId,
        workflowId: workflowId,
        state: workflowState,
        name: name || userWorkflow[0].name,
        short_description: shortDescription || userWorkflow[0].description || '',
        long_description: longDescription || '',
        authorId: userId,
        authorName: authorName || userData[0].name,
        category: category || null,
        price: 'Free', // Default price to Free
        updatedAt: new Date(),
      }

      if (existingPublication.length) {
        // Update existing entry
        result = await db
          .update(templates)
          .set(templatesEntry)
          .where(eq(templates.id, templatesId))
          .returning()
      } else {
        // Create new entry with createdAt and views
        result = await db
          .insert(templates)
          .values({
            ...templatesEntry,
            createdAt: new Date(),
            views: 0,
          })
          .returning()
      }

      logger.info(`[${requestId}] Successfully published templates to templates`, {
        workflowId,
        templatesId,
        userId,
      })

      return NextResponse.json({
        message: 'Templates published successfully',
        data: {
          id: result[0].id,
          workflowId: result[0].workflowId,
          name: result[0].name,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid templates publish request parameters`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          {
            error: 'Invalid request parameters',
            details: validationError.errors,
          },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Templates publish error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
