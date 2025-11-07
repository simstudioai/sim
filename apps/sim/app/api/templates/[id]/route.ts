import { db } from '@sim/db'
import { templates, workflow } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  extractRequiredCredentials,
  sanitizeCredentials,
} from '@/lib/workflows/credential-extractor'

const logger = createLogger('TemplateByIdAPI')

export const revalidate = 0

// GET /api/templates/[id] - Retrieve a single template by ID
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()

    logger.debug(`[${requestId}] Fetching template: ${id}`)

    // Fetch the template by ID
    const result = await db.select().from(templates).where(eq(templates.id, id)).limit(1)

    if (result.length === 0) {
      logger.warn(`[${requestId}] Template not found: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const template = result[0]

    // Only show approved templates to non-authenticated users
    if (!session?.user?.id && template.status !== 'approved') {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Check if user has starred (only if authenticated)
    let isStarred = false
    if (session?.user?.id) {
      const { templateStars } = await import('@sim/db/schema')
      const starResult = await db
        .select()
        .from(templateStars)
        .where(
          sql`${templateStars.templateId} = ${id} AND ${templateStars.userId} = ${session.user.id}`
        )
        .limit(1)
      isStarred = starResult.length > 0
    }

    // Increment the view count (don't fail if this errors)
    try {
      await db
        .update(templates)
        .set({
          views: sql`${templates.views} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, id))

      logger.debug(`[${requestId}] Incremented view count for template: ${id}`)
    } catch (viewError) {
      // Log the error but don't fail the request
      logger.warn(`[${requestId}] Failed to increment view count for template: ${id}`, viewError)
    }

    logger.info(`[${requestId}] Successfully retrieved template: ${id}`)

    return NextResponse.json({
      data: {
        ...template,
        views: template.views + 1, // Return the incremented view count
        isStarred,
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  author: z.string().min(1).max(100).optional(),
  authorType: z.enum(['user', 'organization']).optional(),
  organizationId: z.string().optional(),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional(),
  updateState: z.boolean().optional(), // Explicitly request state update from current workflow
})

// PUT /api/templates/[id] - Update a template
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized template update attempt for ID: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validationResult = updateTemplateSchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid template data for update: ${id}`, validationResult.error)
      return NextResponse.json(
        { error: 'Invalid template data', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const { name, description, author, authorType, organizationId, tags, updateState } =
      validationResult.data

    // Check if template exists
    const existingTemplate = await db.select().from(templates).where(eq(templates.id, id)).limit(1)

    if (existingTemplate.length === 0) {
      logger.warn(`[${requestId}] Template not found for update: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Permission: template owner only
    if (existingTemplate[0].userId !== session.user.id) {
      logger.warn(`[${requestId}] User denied permission to update template ${id}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Prepare update data - only include fields that were provided
    const updateData: any = {
      updatedAt: new Date(),
    }

    // Only update fields that were provided
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (author !== undefined) updateData.author = author
    if (tags !== undefined) updateData.tags = tags

    // Optional fields
    if (authorType) updateData.authorType = authorType
    if (organizationId !== undefined) updateData.organizationId = organizationId

    // Only update the state if explicitly requested and the template has a connected workflow
    if (updateState && existingTemplate[0].workflowId) {
      // Load the current workflow state from normalized tables
      const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/db-helpers')
      const normalizedData = await loadWorkflowFromNormalizedTables(existingTemplate[0].workflowId)

      if (normalizedData) {
        // Also fetch workflow variables
        const [workflowRecord] = await db
          .select({ variables: workflow.variables })
          .from(workflow)
          .where(eq(workflow.id, existingTemplate[0].workflowId))
          .limit(1)

        const currentState = {
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
          variables: workflowRecord?.variables || undefined,
          lastSaved: Date.now(),
        }

        // Extract credential requirements from the new state
        const requiredCredentials = extractRequiredCredentials(currentState)

        // Sanitize the state before storing
        const sanitizedState = sanitizeCredentials(currentState)

        updateData.state = sanitizedState
        updateData.requiredCredentials = requiredCredentials

        logger.info(
          `[${requestId}] Updating template state and credentials from current workflow: ${existingTemplate[0].workflowId}`
        )
      } else {
        logger.warn(`[${requestId}] Could not load workflow state for template: ${id}`)
      }
    }

    const updatedTemplate = await db
      .update(templates)
      .set(updateData)
      .where(eq(templates.id, id))
      .returning()

    logger.info(`[${requestId}] Successfully updated template: ${id}`)

    return NextResponse.json({
      data: updatedTemplate[0],
      message: 'Template updated successfully',
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error updating template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/templates/[id] - Delete a template
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized template delete attempt for ID: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch template
    const existing = await db.select().from(templates).where(eq(templates.id, id)).limit(1)
    if (existing.length === 0) {
      logger.warn(`[${requestId}] Template not found for delete: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const template = existing[0]

    // Permission: owner only
    if (template.userId !== session.user.id) {
      logger.warn(`[${requestId}] User denied permission to delete template ${id}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    await db.delete(templates).where(eq(templates.id, id))

    logger.info(`[${requestId}] Deleted template: ${id}`)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
