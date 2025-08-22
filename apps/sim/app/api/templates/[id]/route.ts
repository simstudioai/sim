import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { hasAdminPermission } from '@/lib/permissions/utils'
import { db } from '@/db'
import { templates, workflow } from '@/db/schema'

const logger = createLogger('TemplateByIdAPI')

export const revalidate = 0

// GET /api/templates/[id] - Retrieve a single template by ID
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized template access attempt for ID: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.debug(`[${requestId}] Fetching template: ${id}`)

    // Fetch the template by ID
    const result = await db.select().from(templates).where(eq(templates.id, id)).limit(1)

    if (result.length === 0) {
      logger.warn(`[${requestId}] Template not found: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const template = result[0]

    // Increment the view count
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
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  author: z.string().min(1).max(100),
  category: z.string().min(1),
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9A-F]{6}$/i),
  state: z.any().optional(), // Workflow state
})

// PUT /api/templates/[id] - Update a template
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
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

    const { name, description, author, category, icon, color, state } = validationResult.data

    // Check if template exists
    const existingTemplate = await db.select().from(templates).where(eq(templates.id, id)).limit(1)

    if (existingTemplate.length === 0) {
      logger.warn(`[${requestId}] Template not found for update: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Permission: template owner OR admin of the workflow's workspace (if any)
    let canUpdate = existingTemplate[0].userId === session.user.id

    if (!canUpdate && existingTemplate[0].workflowId) {
      const wfRows = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, existingTemplate[0].workflowId))
        .limit(1)

      const workspaceId = wfRows[0]?.workspaceId as string | null | undefined
      if (workspaceId) {
        const hasAdmin = await hasAdminPermission(session.user.id, workspaceId)
        if (hasAdmin) canUpdate = true
      }
    }

    if (!canUpdate) {
      logger.warn(`[${requestId}] User denied permission to update template ${id}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Update the template
    const updatedTemplate = await db
      .update(templates)
      .set({
        name,
        description,
        author,
        category,
        icon,
        color,
        ...(state && { state }),
        updatedAt: new Date(),
      })
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
  const requestId = crypto.randomUUID().slice(0, 8)
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

    // Permission: owner or admin of the workflow's workspace (if any)
    let canDelete = template.userId === session.user.id

    if (!canDelete && template.workflowId) {
      // Look up workflow to get workspaceId
      const wfRows = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, template.workflowId))
        .limit(1)

      const workspaceId = wfRows[0]?.workspaceId as string | null | undefined
      if (workspaceId) {
        const hasAdmin = await hasAdminPermission(session.user.id, workspaceId)
        if (hasAdmin) canDelete = true
      }
    }

    if (!canDelete) {
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
