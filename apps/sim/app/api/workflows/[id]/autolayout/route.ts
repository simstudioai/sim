import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { applyAutoLayout } from '@/lib/workflows/autolayout'
import {
  loadWorkflowFromNormalizedTables,
  type NormalizedWorkflowData,
} from '@/lib/workflows/db-helpers'

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
  // Optional: if provided, use these blocks instead of loading from DB
  // This allows using blocks with live measurements from the UI
  blocks: z.record(z.any()).optional(),
  edges: z.array(z.any()).optional(),
  loops: z.record(z.any()).optional(),
  parallels: z.record(z.any()).optional(),
})

/**
 * POST /api/workflows/[id]/autolayout
 * Apply autolayout to an existing workflow
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
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

    // Use provided blocks/edges if available (with live measurements from UI),
    // otherwise load from database
    let currentWorkflowData: NormalizedWorkflowData | null

    if (layoutOptions.blocks && layoutOptions.edges) {
      logger.info(`[${requestId}] Using provided blocks with live measurements`)
      currentWorkflowData = {
        blocks: layoutOptions.blocks,
        edges: layoutOptions.edges,
        loops: layoutOptions.loops || {},
        parallels: layoutOptions.parallels || {},
        isFromNormalizedTables: false,
      }
    } else {
      logger.info(`[${requestId}] Loading blocks from database`)
      currentWorkflowData = await loadWorkflowFromNormalizedTables(workflowId)
    }

    if (!currentWorkflowData) {
      logger.error(`[${requestId}] Could not load workflow ${workflowId} for autolayout`)
      return NextResponse.json({ error: 'Could not load workflow data' }, { status: 500 })
    }

    const autoLayoutOptions = {
      horizontalSpacing: layoutOptions.spacing?.horizontal || 550,
      verticalSpacing: layoutOptions.spacing?.vertical || 200,
      padding: {
        x: layoutOptions.padding?.x || 150,
        y: layoutOptions.padding?.y || 150,
      },
      alignment: layoutOptions.alignment,
    }

    const layoutResult = applyAutoLayout(
      currentWorkflowData.blocks,
      currentWorkflowData.edges,
      currentWorkflowData.loops || {},
      currentWorkflowData.parallels || {},
      autoLayoutOptions
    )

    if (!layoutResult.success || !layoutResult.blocks) {
      logger.error(`[${requestId}] Auto layout failed:`, {
        error: layoutResult.error,
      })
      return NextResponse.json(
        {
          error: 'Auto layout failed',
          details: layoutResult.error || 'Unknown error',
        },
        { status: 500 }
      )
    }

    const elapsed = Date.now() - startTime
    const blockCount = Object.keys(layoutResult.blocks).length

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
        layoutedBlocks: layoutResult.blocks,
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
