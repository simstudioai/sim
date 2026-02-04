import { db } from '@sim/db'
import { templateCreators, templates, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  extractRequiredCredentials,
  sanitizeCredentials,
} from '@/lib/workflows/credentials/credential-extractor'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplateByIdAPI')

export const revalidate = 0

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()

    logger.debug(`[${requestId}] Fetching template: ${id}`)

    const result = await db
      .select({
        template: templates,
        creator: templateCreators,
      })
      .from(templates)
      .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
      .where(eq(templates.id, id))
      .limit(1)

    if (result.length === 0) {
      logger.warn(`[${requestId}] Template not found: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const { template, creator } = result[0]
    const templateWithCreator = {
      ...template,
      creator: creator || undefined,
    }

    if (!session?.user?.id && template.status !== 'approved') {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

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

    const shouldIncrementView = template.status === 'approved'

    if (shouldIncrementView) {
      try {
        await db
          .update(templates)
          .set({
            views: sql`${templates.views} + 1`,
          })
          .where(eq(templates.id, id))

        logger.debug(`[${requestId}] Incremented view count for template: ${id}`)
      } catch (viewError) {
        logger.warn(`[${requestId}] Failed to increment view count for template: ${id}`, viewError)
      }
    }

    logger.info(`[${requestId}] Successfully retrieved template: ${id}`)

    return NextResponse.json({
      data: {
        ...templateWithCreator,
        views: template.views + (shouldIncrementView ? 1 : 0),
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
  details: z
    .object({
      tagline: z.string().max(500, 'Tagline must be less than 500 characters').optional(),
      about: z.string().optional(), // Markdown long description
    })
    .optional(),
  creatorId: z.string().optional(), // Creator profile ID
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional(),
  updateState: z.boolean().optional(), // Explicitly request state update from current workflow
  status: z.enum(['approved', 'rejected', 'pending']).optional(), // Status change (super users only)
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

    const { name, details, creatorId, tags, updateState, status } = validationResult.data

    const existingTemplate = await db.select().from(templates).where(eq(templates.id, id)).limit(1)

    if (existingTemplate.length === 0) {
      logger.warn(`[${requestId}] Template not found for update: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const template = existingTemplate[0]

    // Status changes require super user permission
    if (status !== undefined) {
      const { verifyEffectiveSuperUser } = await import('@/lib/templates/permissions')
      const { effectiveSuperUser } = await verifyEffectiveSuperUser(session.user.id)
      if (!effectiveSuperUser) {
        logger.warn(`[${requestId}] Non-super user attempted to change template status: ${id}`)
        return NextResponse.json(
          { error: 'Only super users can change template status' },
          { status: 403 }
        )
      }
    }

    // For non-status updates, verify creator permission
    const hasNonStatusUpdates =
      name !== undefined ||
      details !== undefined ||
      creatorId !== undefined ||
      tags !== undefined ||
      updateState

    if (hasNonStatusUpdates) {
      if (!template.creatorId) {
        logger.warn(`[${requestId}] Template ${id} has no creator, denying update`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      const { verifyCreatorPermission } = await import('@/lib/templates/permissions')
      const { hasPermission, error: permissionError } = await verifyCreatorPermission(
        session.user.id,
        template.creatorId,
        'admin'
      )

      if (!hasPermission) {
        logger.warn(`[${requestId}] User denied permission to update template ${id}`)
        return NextResponse.json({ error: permissionError || 'Access denied' }, { status: 403 })
      }
    }

    const updateData: any = {
      updatedAt: new Date(),
    }

    if (name !== undefined) updateData.name = name
    if (details !== undefined) updateData.details = details
    if (tags !== undefined) updateData.tags = tags
    if (creatorId !== undefined) updateData.creatorId = creatorId
    if (status !== undefined) updateData.status = status

    if (updateState && template.workflowId) {
      const { verifyWorkflowAccess } = await import('@/socket/middleware/permissions')
      const { hasAccess: hasWorkflowAccess } = await verifyWorkflowAccess(
        session.user.id,
        template.workflowId
      )

      if (!hasWorkflowAccess) {
        logger.warn(`[${requestId}] User denied workflow access for state sync on template ${id}`)
        return NextResponse.json({ error: 'Access denied to workflow' }, { status: 403 })
      }

      const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')
      const normalizedData = await loadWorkflowFromNormalizedTables(template.workflowId)

      if (normalizedData) {
        const [workflowRecord] = await db
          .select({ variables: workflow.variables })
          .from(workflow)
          .where(eq(workflow.id, template.workflowId))
          .limit(1)

        const currentState: Partial<WorkflowState> = {
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
          variables: (workflowRecord?.variables as WorkflowState['variables']) ?? undefined,
          lastSaved: Date.now(),
        }

        const requiredCredentials = extractRequiredCredentials(currentState)

        const sanitizedState = sanitizeCredentials(currentState)

        updateData.state = sanitizedState
        updateData.requiredCredentials = requiredCredentials

        logger.info(
          `[${requestId}] Updating template state and credentials from current workflow: ${template.workflowId}`
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

    const existing = await db.select().from(templates).where(eq(templates.id, id)).limit(1)
    if (existing.length === 0) {
      logger.warn(`[${requestId}] Template not found for delete: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const template = existing[0]

    if (!template.creatorId) {
      logger.warn(`[${requestId}] Template ${id} has no creator, denying delete`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { verifyCreatorPermission } = await import('@/lib/templates/permissions')
    const { hasPermission, error: permissionError } = await verifyCreatorPermission(
      session.user.id,
      template.creatorId,
      'admin'
    )

    if (!hasPermission) {
      logger.warn(`[${requestId}] User denied permission to delete template ${id}`)
      return NextResponse.json({ error: permissionError || 'Access denied' }, { status: 403 })
    }

    await db.delete(templates).where(eq(templates.id, id))

    logger.info(`[${requestId}] Deleted template: ${id}`)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
