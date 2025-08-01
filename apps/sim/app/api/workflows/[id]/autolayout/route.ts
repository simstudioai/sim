import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { simAgentClient } from '@/lib/sim-agent'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('AutoLayoutAPI')

// Check API key configuration at module level
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY
if (!SIM_AGENT_API_KEY) {
  logger.warn('SIM_AGENT_API_KEY not configured - autolayout requests will fail')
}

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
      `[${requestId}] Applying autolayout to ${Object.keys(currentWorkflowData.blocks).length} blocks`,
      {
        hasApiKey: !!SIM_AGENT_API_KEY,
        simAgentUrl: process.env.SIM_AGENT_API_URL || 'http://localhost:8000',
      }
    )

    // Create workflow state for autolayout
    const workflowState = {
      blocks: currentWorkflowData.blocks,
      edges: currentWorkflowData.edges,
      loops: currentWorkflowData.loops || {},
      parallels: currentWorkflowData.parallels || {},
    }

    const autoLayoutOptions = {
      strategy: layoutOptions.strategy,
      direction: layoutOptions.direction,
      spacing: {
        horizontal: layoutOptions.spacing?.horizontal || 500,
        vertical: layoutOptions.spacing?.vertical || 400,
        layer: layoutOptions.spacing?.layer || 700,
      },
      alignment: layoutOptions.alignment,
      padding: {
        x: layoutOptions.padding?.x || 250,
        y: layoutOptions.padding?.y || 250,
      },
    }

    // Gather block registry and utilities for sim-agent
    const blocks = getAllBlocks()
    const blockRegistry = blocks.reduce(
      (acc, block) => {
        const blockType = block.type
        acc[blockType] = {
          ...block,
          id: blockType,
          subBlocks: block.subBlocks || [],
          outputs: block.outputs || {},
        } as any
        return acc
      },
      {} as Record<string, BlockConfig>
    )

    const autoLayoutResult = await simAgentClient.makeRequest('/api/yaml/autolayout', {
      body: {
        workflowState,
        options: autoLayoutOptions,
        blockRegistry,
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
        },
      },
      apiKey: SIM_AGENT_API_KEY,
    })

    // Log the full response for debugging
    logger.info(`[${requestId}] Sim-agent autolayout response:`, {
      success: autoLayoutResult.success,
      status: autoLayoutResult.status,
      error: autoLayoutResult.error,
      hasData: !!autoLayoutResult.data,
      hasWorkflowState: !!autoLayoutResult.data?.workflowState,
      hasBlocks: !!autoLayoutResult.data?.blocks,
      dataKeys: autoLayoutResult.data ? Object.keys(autoLayoutResult.data) : [],
    })

    if (
      !autoLayoutResult.success ||
      (!autoLayoutResult.data?.workflowState && !autoLayoutResult.data?.blocks)
    ) {
      logger.error(`[${requestId}] Auto layout failed:`, {
        success: autoLayoutResult.success,
        error: autoLayoutResult.error,
        status: autoLayoutResult.status,
        fullResponse: autoLayoutResult,
      })
      const errorMessage =
        autoLayoutResult.error ||
        (autoLayoutResult.status === 401
          ? 'Unauthorized - check API key'
          : autoLayoutResult.status === 404
            ? 'Sim-agent service not found'
            : `HTTP ${autoLayoutResult.status}`)

      return NextResponse.json(
        {
          error: 'Auto layout failed',
          details: errorMessage,
        },
        { status: 500 }
      )
    }

    // Handle both response formats from sim-agent
    const layoutedBlocks =
      autoLayoutResult.data?.workflowState?.blocks || autoLayoutResult.data?.blocks

    if (!layoutedBlocks) {
      logger.error(`[${requestId}] No blocks returned from sim-agent:`, {
        responseData: autoLayoutResult.data,
      })
      return NextResponse.json(
        {
          error: 'Auto layout failed',
          details: 'No blocks returned from sim-agent',
        },
        { status: 500 }
      )
    }

    const elapsed = Date.now() - startTime
    const blockCount = Object.keys(layoutedBlocks).length

    logger.info(`[${requestId}] Autolayout completed successfully in ${elapsed}ms`, {
      blockCount,
      strategy: layoutOptions.strategy,
      workflowId,
    })

    // Return the layouted blocks to the frontend - let the store handle saving
    return NextResponse.json({
      success: true,
      message: `Autolayout applied successfully to ${blockCount} blocks`,
      data: {
        strategy: layoutOptions.strategy,
        direction: layoutOptions.direction,
        blockCount,
        elapsed: `${elapsed}ms`,
        layoutedBlocks: layoutedBlocks,
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
