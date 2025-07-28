import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { autoLayoutWorkflow } from '@/lib/autolayout/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('AutoLayoutAPI')

const AutoLayoutRequestSchema = z.object({
  strategy: z
    .enum(['smart', 'hierarchical', 'layered', 'force-directed'])
    .optional()
    .default('smart'),
  direction: z.enum(['horizontal', 'vertical', 'auto']).optional().default('auto'),
  spacing: z
    .object({
      horizontal: z.number().min(100).max(1000).optional().default(400),
      vertical: z.number().min(50).max(500).optional().default(200),
      layer: z.number().min(200).max(1200).optional().default(600),
    })
    .optional()
    .default({}),
  alignment: z.enum(['start', 'center', 'end']).optional().default('center'),
  padding: z
    .object({
      x: z.number().min(50).max(500).optional().default(200),
      y: z.number().min(50).max(500).optional().default(200),
    })
    .optional()
    .default({}),
})

type AutoLayoutRequest = z.infer<typeof AutoLayoutRequestSchema>

/**
 * POST /api/workflows/[id]/autolayout
 * Apply autolayout to an existing workflow
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized autolayout attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse request body
    const body = await request.json()
    const layoutOptions = AutoLayoutRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing autolayout request for workflow ${workflowId}`, {
      strategy: layoutOptions.strategy,
      direction: layoutOptions.direction,
      userId,
    })

    // Fetch the workflow to check ownership/access
    const workflowData = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for autolayout`)
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
        `[${requestId}] User ${userId} denied permission to autolayout workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Load current workflow state
    const currentWorkflowData = await loadWorkflowFromNormalizedTables(workflowId)

    if (!currentWorkflowData) {
      logger.error(`[${requestId}] Could not load workflow ${workflowId} for autolayout`)
      return NextResponse.json({ error: 'Could not load workflow data' }, { status: 500 })
    }

    // Apply autolayout
    logger.info(
      `[${requestId}] Applying autolayout to ${Object.keys(currentWorkflowData.blocks).length} blocks`
    )

    const layoutedBlocks = await autoLayoutWorkflow(
      currentWorkflowData.blocks,
      currentWorkflowData.edges,
      {
        strategy: layoutOptions.strategy,
        direction: layoutOptions.direction,
        spacing: {
          horizontal: layoutOptions.spacing?.horizontal || 400,
          vertical: layoutOptions.spacing?.vertical || 200,
          layer: layoutOptions.spacing?.layer || 600,
        },
        alignment: layoutOptions.alignment,
        padding: {
          x: layoutOptions.padding?.x || 200,
          y: layoutOptions.padding?.y || 200,
        },
      }
    )

    // Create updated workflow state
    const updatedWorkflowState = {
      ...currentWorkflowData,
      blocks: layoutedBlocks,
      lastSaved: Date.now(),
    }

    // Save to database
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, updatedWorkflowState)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save autolayout results:`, saveResult.error)
      return NextResponse.json(
        { error: 'Failed to save autolayout results', details: saveResult.error },
        { status: 500 }
      )
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflowTable)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
        state: saveResult.jsonBlob,
      })
      .where(eq(workflowTable.id, workflowId))

    // Notify the socket server to tell clients about the autolayout update
    try {
      const socketUrl = process.env.SOCKET_URL || 'http://localhost:3002'
      await fetch(`${socketUrl}/api/workflow-updated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId }),
      })
      logger.info(`[${requestId}] Notified socket server of autolayout update`)
    } catch (socketError) {
      logger.warn(`[${requestId}] Failed to notify socket server:`, socketError)
    }

    const elapsed = Date.now() - startTime
    const blockCount = Object.keys(layoutedBlocks).length

    logger.info(`[${requestId}] Autolayout completed successfully in ${elapsed}ms`, {
      blockCount,
      strategy: layoutOptions.strategy,
      workflowId,
    })

    return NextResponse.json({
      success: true,
      message: `Autolayout applied successfully to ${blockCount} blocks`,
      data: {
        strategy: layoutOptions.strategy,
        direction: layoutOptions.direction,
        blockCount,
        elapsed: `${elapsed}ms`,
      },
    })
  } catch (error) {
    const elapsed = Date.now() - startTime

    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid autolayout request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Autolayout failed after ${elapsed}ms:`, error)
    return NextResponse.json(
      {
        error: 'Autolayout failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
