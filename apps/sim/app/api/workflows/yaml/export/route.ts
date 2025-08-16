import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { simAgentClient } from '@/lib/sim-agent'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowYamlExportAPI')

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const url = new URL(request.url)
  const workflowId = url.searchParams.get('workflowId')

  try {
    logger.info(`[${requestId}] Exporting workflow YAML from database: ${workflowId}`)

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 })
    }

    // Get the session for authentication
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Fetch the workflow from database
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

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      hasAccess = true
    }

    // Case 2: Workflow belongs to a workspace the user has permissions for
    if (!hasAccess && workflowData.workspaceId) {
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

    // Try to load from normalized tables first
    logger.debug(`[${requestId}] Attempting to load workflow ${workflowId} from normalized tables`)
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    let workflowState: any
    const subBlockValues: Record<string, Record<string, any>> = {}

    if (normalizedData) {
      logger.debug(`[${requestId}] Found normalized data for workflow ${workflowId}:`, {
        blocksCount: Object.keys(normalizedData.blocks).length,
        edgesCount: normalizedData.edges.length,
      })

      // Use normalized table data - construct state from normalized tables
      workflowState = {
        deploymentStatuses: {},
        hasActiveWebhook: false,
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
        lastSaved: Date.now(),
        isDeployed: workflowData.isDeployed || false,
        deployedAt: workflowData.deployedAt,
      }

      // Extract subblock values from the normalized blocks
      Object.entries(normalizedData.blocks).forEach(([blockId, block]: [string, any]) => {
        subBlockValues[blockId] = {}
        if (block.subBlocks) {
          Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
            if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
              subBlockValues[blockId][subBlockId] = subBlock.value
            }
          })
        }
      })

      logger.info(`[${requestId}] Loaded workflow ${workflowId} from normalized tables`)
    } else {
      return NextResponse.json(
        { success: false, error: 'Workflow has no normalized data' },
        { status: 400 }
      )
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

    // Call sim-agent directly
    const result = await simAgentClient.makeRequest('/api/workflow/to-yaml', {
      body: {
        workflowState,
        subBlockValues,
        blockRegistry,
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
        },
      },
    })

    if (!result.success || !result.data?.yaml) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to generate YAML',
        },
        { status: result.status || 500 }
      )
    }

    logger.info(`[${requestId}] Successfully generated YAML from database`, {
      yamlLength: result.data.yaml.length,
    })

    return NextResponse.json({
      success: true,
      yaml: result.data.yaml,
    })
  } catch (error) {
    logger.error(`[${requestId}] YAML export failed`, error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to export YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
