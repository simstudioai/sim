import { db } from '@sim/db'
import { templates, webhook, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { env } from '@/lib/core/config/env'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { authorizeWorkflowByWorkspacePermission, getWorkflowById } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowByIdAPI')

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

/**
 * GET /api/workflows/[id]
 * Fetch a single workflow by ID
 * Uses hybrid approach: try normalized tables first, fallback to JSON blob
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success) {
      logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = auth.userId || null

    let workflowData = await getWorkflowById(workflowId)

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has access to this workflow
    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })
    if (!authorization.workflow) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    workflowData = authorization.workflow
    if (!authorization.allowed) {
      logger.warn(`[${requestId}] User ${userId} denied access to workflow ${workflowId}`)
      return NextResponse.json(
        { error: authorization.message || 'Access denied' },
        { status: authorization.status }
      )
    }

    logger.debug(`[${requestId}] Attempting to load workflow ${workflowId} from normalized tables`)
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (normalizedData) {
      logger.debug(`[${requestId}] Found normalized data for workflow ${workflowId}:`, {
        blocksCount: Object.keys(normalizedData.blocks).length,
        edgesCount: normalizedData.edges.length,
        loopsCount: Object.keys(normalizedData.loops).length,
        parallelsCount: Object.keys(normalizedData.parallels).length,
        loops: normalizedData.loops,
      })

      const finalWorkflowData = {
        ...workflowData,
        state: {
          deploymentStatuses: {},
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
          lastSaved: Date.now(),
          isDeployed: workflowData.isDeployed || false,
          deployedAt: workflowData.deployedAt,
          metadata: {
            name: workflowData.name,
            description: workflowData.description,
          },
        },
        variables: workflowData.variables || {},
      }

      logger.info(`[${requestId}] Loaded workflow ${workflowId} from normalized tables`)
      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Successfully fetched workflow ${workflowId} in ${elapsed}ms`)

      return NextResponse.json({ data: finalWorkflowData }, { status: 200 })
    }

    const emptyWorkflowData = {
      ...workflowData,
      state: {
        deploymentStatuses: {},
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: Date.now(),
        isDeployed: workflowData.isDeployed || false,
        deployedAt: workflowData.deployedAt,
        metadata: {
          name: workflowData.name,
          description: workflowData.description,
        },
      },
      variables: workflowData.variables || {},
    }

    return NextResponse.json({ data: emptyWorkflowData }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error fetching workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows/[id]
 * Delete a workflow by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized deletion attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = auth.userId

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'admin',
    })
    const workflowData = authorization.workflow || (await getWorkflowById(workflowId))

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for deletion`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const canDelete = authorization.allowed

    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to delete workflow ${workflowId}`
      )
      return NextResponse.json(
        { error: authorization.message || 'Access denied' },
        { status: authorization.status || 403 }
      )
    }

    // Check if this is the last workflow in the workspace
    if (workflowData.workspaceId) {
      const totalWorkflowsInWorkspace = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workflowData.workspaceId))

      if (totalWorkflowsInWorkspace.length <= 1) {
        return NextResponse.json(
          { error: 'Cannot delete the only workflow in the workspace' },
          { status: 400 }
        )
      }
    }

    // Check if workflow has published templates before deletion
    const { searchParams } = new URL(request.url)
    const checkTemplates = searchParams.get('check-templates') === 'true'
    const deleteTemplatesParam = searchParams.get('deleteTemplates')

    if (checkTemplates) {
      // Return template information for frontend to handle
      const publishedTemplates = await db
        .select({
          id: templates.id,
          name: templates.name,
          views: templates.views,
          stars: templates.stars,
          status: templates.status,
        })
        .from(templates)
        .where(eq(templates.workflowId, workflowId))

      return NextResponse.json({
        hasPublishedTemplates: publishedTemplates.length > 0,
        count: publishedTemplates.length,
        publishedTemplates: publishedTemplates.map((t) => ({
          id: t.id,
          name: t.name,
          views: t.views,
          stars: t.stars,
        })),
      })
    }

    // Handle template deletion based on user choice
    if (deleteTemplatesParam !== null) {
      const deleteTemplates = deleteTemplatesParam === 'delete'

      if (deleteTemplates) {
        // Delete all templates associated with this workflow
        await db.delete(templates).where(eq(templates.workflowId, workflowId))
        logger.info(`[${requestId}] Deleted templates for workflow ${workflowId}`)
      } else {
        // Orphan the templates (set workflowId to null)
        await db
          .update(templates)
          .set({ workflowId: null })
          .where(eq(templates.workflowId, workflowId))
        logger.info(`[${requestId}] Orphaned templates for workflow ${workflowId}`)
      }
    }

    // Clean up external webhooks before deleting workflow
    try {
      const { cleanupExternalWebhook } = await import('@/lib/webhooks/provider-subscriptions')
      const webhooksToCleanup = await db
        .select({
          webhook: webhook,
          workflow: {
            id: workflow.id,
            userId: workflow.userId,
            workspaceId: workflow.workspaceId,
          },
        })
        .from(webhook)
        .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
        .where(eq(webhook.workflowId, workflowId))

      if (webhooksToCleanup.length > 0) {
        logger.info(
          `[${requestId}] Found ${webhooksToCleanup.length} webhook(s) to cleanup for workflow ${workflowId}`
        )

        // Clean up each webhook (don't fail if cleanup fails)
        for (const webhookData of webhooksToCleanup) {
          try {
            await cleanupExternalWebhook(webhookData.webhook, webhookData.workflow, requestId)
          } catch (cleanupError) {
            logger.warn(
              `[${requestId}] Failed to cleanup external webhook ${webhookData.webhook.id} during workflow deletion`,
              cleanupError
            )
            // Continue with deletion even if cleanup fails
          }
        }
      }
    } catch (webhookCleanupError) {
      logger.warn(
        `[${requestId}] Error during webhook cleanup for workflow deletion (continuing with deletion)`,
        webhookCleanupError
      )
      // Continue with workflow deletion even if webhook cleanup fails
    }

    await db.delete(workflow).where(eq(workflow.id, workflowId))

    try {
      PlatformEvents.workflowDeleted({
        workflowId,
        workspaceId: workflowData.workspaceId || undefined,
      })
    } catch {
      // Telemetry should not fail the operation
    }

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully deleted workflow ${workflowId} in ${elapsed}ms`)

    // Notify Socket.IO system to disconnect users from this workflow's room
    // This prevents "Block not found" errors when collaborative updates try to process
    // after the workflow has been deleted
    try {
      const socketUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
      const socketResponse = await fetch(`${socketUrl}/api/workflow-deleted`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.INTERNAL_API_SECRET,
        },
        body: JSON.stringify({ workflowId }),
      })

      if (socketResponse.ok) {
        logger.info(
          `[${requestId}] Notified Socket.IO server about workflow ${workflowId} deletion`
        )
      } else {
        logger.warn(
          `[${requestId}] Failed to notify Socket.IO server about workflow ${workflowId} deletion`
        )
      }
    } catch (error) {
      logger.warn(
        `[${requestId}] Error notifying Socket.IO server about workflow ${workflowId} deletion:`,
        error
      )
      // Don't fail the deletion if Socket.IO notification fails
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error deleting workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows/[id]
 * Update workflow metadata (name, description, color, folderId)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized update attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = auth.userId

    const body = await request.json()
    const updates = UpdateWorkflowSchema.parse(body)

    // Fetch the workflow to check ownership/access
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'write',
    })
    const workflowData = authorization.workflow || (await getWorkflowById(workflowId))

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for update`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const canUpdate = authorization.allowed

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to update workflow ${workflowId}`
      )
      return NextResponse.json(
        { error: authorization.message || 'Access denied' },
        { status: authorization.status || 403 }
      )
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.color !== undefined) updateData.color = updates.color
    if (updates.folderId !== undefined) updateData.folderId = updates.folderId
    if (updates.sortOrder !== undefined) updateData.sortOrder = updates.sortOrder

    // Update the workflow
    const [updatedWorkflow] = await db
      .update(workflow)
      .set(updateData)
      .where(eq(workflow.id, workflowId))
      .returning()

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully updated workflow ${workflowId} in ${elapsed}ms`, {
      updates: updateData,
    })

    return NextResponse.json({ workflow: updatedWorkflow }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid workflow update data for ${workflowId}`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error updating workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
