import { db } from '@sim/db'
import { templates, workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions, hasAdminPermission } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'

const logger = createLogger('WorkflowByIdAPI')

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
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
    const authHeader = request.headers.get('authorization')
    let isInternalCall = false

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      isInternalCall = await verifyInternalToken(token)
    }

    let userId: string | null = null

    if (isInternalCall) {
      logger.info(`[${requestId}] Internal API call for workflow ${workflowId}`)
    } else {
      const session = await getSession()
      let authenticatedUserId: string | null = session?.user?.id || null

      if (!authenticatedUserId) {
        const apiKeyHeader = request.headers.get('x-api-key')
        if (apiKeyHeader) {
          const authResult = await authenticateApiKeyFromHeader(apiKeyHeader)
          if (authResult.success && authResult.userId) {
            authenticatedUserId = authResult.userId
            if (authResult.keyId) {
              await updateApiKeyLastUsed(authResult.keyId).catch((error) => {
                logger.warn(`[${requestId}] Failed to update API key last used timestamp:`, {
                  keyId: authResult.keyId,
                  error,
                })
              })
            }
          }
        }
      }

      if (!authenticatedUserId) {
        logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      userId = authenticatedUserId
    }

    // Fetch the workflow
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has access to this workflow
    let hasAccess = false

    if (isInternalCall) {
      // Internal calls have full access
      hasAccess = true
    } else {
      // Case 1: User owns the workflow
      if (workflowData.userId === userId) {
        hasAccess = true
      }

      // Case 2: Workflow belongs to a workspace the user has permissions for
      if (!hasAccess && workflowData.workspaceId && userId) {
        const userPermission = await getUserEntityPermissions(
          userId,
          'workspace',
          workflowData.workspaceId
        )
        if (userPermission !== null) {
          hasAccess = true
        }
      }

      if (!hasAccess) {
        logger.warn(`[${requestId}] User ${userId} denied access to workflow ${workflowId}`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
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
          // Default values for expected properties
          deploymentStatuses: {},
          // Data from normalized tables
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
          lastSaved: Date.now(),
          isDeployed: workflowData.isDeployed || false,
          deployedAt: workflowData.deployedAt,
        },
      }

      logger.info(`[${requestId}] Loaded workflow ${workflowId} from normalized tables`)
      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Successfully fetched workflow ${workflowId} in ${elapsed}ms`)

      return NextResponse.json({ data: finalWorkflowData }, { status: 200 })
    }
    return NextResponse.json({ error: 'Workflow has no normalized data' }, { status: 400 })
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
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized deletion attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for deletion`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to delete this workflow
    let canDelete = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      canDelete = true
    }

    // Case 2: Workflow belongs to a workspace and user has admin permission
    if (!canDelete && workflowData.workspaceId) {
      const hasAdmin = await hasAdminPermission(userId, workflowData.workspaceId)
      if (hasAdmin) {
        canDelete = true
      }
    }

    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to delete workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if workflow has published templates before deletion
    const { searchParams } = new URL(request.url)
    const checkTemplates = searchParams.get('check-templates') === 'true'
    const deleteTemplatesParam = searchParams.get('deleteTemplates')

    if (checkTemplates) {
      // Return template information for frontend to handle
      const publishedTemplates = await db
        .select()
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

    await db.delete(workflow).where(eq(workflow.id, workflowId))

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully deleted workflow ${workflowId} in ${elapsed}ms`)

    // Notify Socket.IO system to disconnect users from this workflow's room
    // This prevents "Block not found" errors when collaborative updates try to process
    // after the workflow has been deleted
    try {
      const socketUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
      const socketResponse = await fetch(`${socketUrl}/api/workflow-deleted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized update attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse and validate request body
    const body = await request.json()
    const updates = UpdateWorkflowSchema.parse(body)

    // Fetch the workflow to check ownership/access
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for update`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to update this workflow
    let canUpdate = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      canUpdate = true
    }

    // Case 2: Workflow belongs to a workspace and user has write or admin permission
    if (!canUpdate && workflowData.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowData.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canUpdate = true
      }
    }

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to update workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Build update object
    const updateData: any = { updatedAt: new Date() }
    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.color !== undefined) updateData.color = updates.color
    if (updates.folderId !== undefined) updateData.folderId = updates.folderId

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
