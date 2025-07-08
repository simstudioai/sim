import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { workflowStateApiSchema } from '@/lib/workflows/validation'
import { db } from '@/db'
import { workflow } from '@/db/schema'

const logger = createLogger('ForceSync')

/**
 * POST /api/workflows/[id]/force-sync
 * Force sync local workflow state to database immediately
 * Used during socket reconnection to ensure local changes are persisted
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: workflowId } = await params

  try {
    logger.info(`[${requestId}] Force sync request for workflow ${workflowId}`)

    // Get session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized force sync attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Get workflow and verify access (inline implementation)
    const workflowData = await db
      .select({
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
        name: workflow.name,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData.length) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const workflowRecord = workflowData[0]
    let hasAccess = false

    // Check if user owns the workflow
    if (workflowRecord.userId === userId) {
      hasAccess = true
    }

    // Check workspace membership if workflow belongs to a workspace
    if (!hasAccess && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowRecord.workspaceId
      )
      hasAccess = userPermission !== null
    }

    if (!hasAccess) {
      logger.warn(`[${requestId}] Access denied for user ${userId} to workflow ${workflowId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Parse and validate the workflow state from request body
    const body = await request.json()
    const { workflowState } = body

    if (!workflowState) {
      return NextResponse.json({ error: 'Missing workflowState in request body' }, { status: 400 })
    }

    // Validate the workflow state structure
    const validationResult = workflowStateApiSchema.safeParse(workflowState)
    if (!validationResult.success) {
      logger.error(`[${requestId}] Invalid workflow state structure:`, {
        error: validationResult.error,
        receivedData: JSON.stringify(workflowState, null, 2),
      })
      return NextResponse.json(
        {
          error: 'Invalid workflow state structure',
          details: validationResult.error.issues,
          receivedKeys: Object.keys(workflowState || {}),
        },
        { status: 400 }
      )
    }

    const validatedState = validationResult.data

    // Save to normalized tables
    logger.info(`[${requestId}] Saving workflow state to normalized tables`)

    // Convert deployedAt to Date if it's a string
    let deployedAt: Date | undefined
    if (validatedState.deployedAt) {
      if (typeof validatedState.deployedAt === 'string') {
        deployedAt = new Date(validatedState.deployedAt)
      } else if (validatedState.deployedAt instanceof Date) {
        deployedAt = validatedState.deployedAt
      }
    }

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, {
      blocks: validatedState.blocks,
      edges: validatedState.edges,
      loops: validatedState.loops || {},
      parallels: validatedState.parallels || {},
      lastSaved: Date.now(),
      isDeployed: validatedState.isDeployed,
      deployedAt,
      deploymentStatuses: validatedState.deploymentStatuses || {},
      hasActiveSchedule: validatedState.hasActiveSchedule || false,
      hasActiveWebhook: validatedState.hasActiveWebhook || false,
    })

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow state:`, saveResult.error)
      return NextResponse.json(
        { error: saveResult.error || 'Failed to save workflow state' },
        { status: 500 }
      )
    }

    // Update workflow's last_synced timestamp
    await db
      .update(workflow)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflow.id, workflowId))

    logger.info(`[${requestId}] Successfully force synced workflow ${workflowId}`)

    // Notify socket server about the sync for real-time updates
    try {
      const socketServerUrl = process.env.SOCKET_SERVER_URL || 'http://localhost:3002'
      await fetch(`${socketServerUrl}/api/workflow-synced`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          timestamp: Date.now(),
          userId,
        }),
      })
      logger.debug(`[${requestId}] Notified socket server about force sync`)
    } catch (socketError) {
      // Don't fail the request if socket notification fails
      logger.warn(`[${requestId}] Failed to notify socket server about sync:`, socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Workflow state synced successfully',
      timestamp: Date.now(),
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Force sync error:`, error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
