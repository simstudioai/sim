import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { getBlock } from '@/blocks'
import { db } from '@/db'
import { copilotCheckpoints, workflow as workflowTable } from '@/db/schema'
import { convertYamlToWorkflow, parseWorkflowYaml } from '@/stores/workflows/yaml/importer'

const logger = createLogger('RevertCheckpointAPI')

/**
 * POST /api/copilot/checkpoints/[id]/revert
 * Revert workflow to a specific checkpoint
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const checkpointId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info(`[${requestId}] Reverting to checkpoint: ${checkpointId}`, {
      userId: session.user.id,
    })

    // Get the checkpoint
    const checkpoint = await db
      .select()
      .from(copilotCheckpoints)
      .where(
        and(eq(copilotCheckpoints.id, checkpointId), eq(copilotCheckpoints.userId, session.user.id))
      )
      .limit(1)

    if (!checkpoint.length) {
      return NextResponse.json({ error: 'Checkpoint not found' }, { status: 404 })
    }

    const checkpointData = checkpoint[0]
    const { workflowId, yaml: yamlContent } = checkpointData

    logger.info(`[${requestId}] Processing checkpoint revert`, {
      workflowId,
      yamlLength: yamlContent.length,
    })

    // Parse YAML content
    const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(yamlContent)

    if (!yamlWorkflow || parseErrors.length > 0) {
      logger.error(`[${requestId}] YAML parsing failed`, { parseErrors })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to parse checkpoint YAML',
          details: parseErrors,
        },
        { status: 400 }
      )
    }

    // Convert YAML to workflow format
    const { blocks, edges, errors: convertErrors, warnings } = convertYamlToWorkflow(yamlWorkflow)

    if (convertErrors.length > 0) {
      logger.error(`[${requestId}] YAML conversion failed`, { convertErrors })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to convert checkpoint YAML to workflow',
          details: convertErrors,
        },
        { status: 400 }
      )
    }

    // Create workflow state (same format as edit-workflow)
    const newWorkflowState: any = {
      blocks: {} as Record<string, any>,
      edges: [] as any[],
      loops: {} as Record<string, any>,
      parallels: {} as Record<string, any>,
      lastSaved: Date.now(),
      isDeployed: false,
      deployedAt: undefined,
      deploymentStatuses: {} as Record<string, any>,
      hasActiveSchedule: false,
      hasActiveWebhook: false,
    }

    // Process blocks with new IDs (complete replacement)
    const blockIdMapping = new Map<string, string>()

    for (const block of blocks) {
      const newId = crypto.randomUUID()
      blockIdMapping.set(block.id, newId)

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.warn(`[${requestId}] Unknown block type: ${block.type}`)
        continue
      }

      // Create subBlocks for the block with block reference mapping
      const subBlocks: Record<string, any> = {}
      blockConfig.subBlocks.forEach((subBlock) => {
        let value = block.inputs[subBlock.id] || null
        
        // Update block references in values to use new mapped IDs
        if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
          const blockMatches = value.match(/<([^>]+)>/g)
          if (blockMatches) {
            for (const match of blockMatches) {
              const path = match.slice(1, -1)
              const [blockRef] = path.split('.')
              
              // Skip system references (start, loop, parallel, variable)
              if (['start', 'loop', 'parallel', 'variable'].includes(blockRef.toLowerCase())) {
                continue
              }
              
              // Check if this references an old block ID that needs mapping
              const newMappedId = blockIdMapping.get(blockRef)
              if (newMappedId) {
                logger.info(`[${requestId}] Updating block reference: ${blockRef} -> ${newMappedId}`)
                value = value.replace(new RegExp(`<${blockRef}\\.`, 'g'), `<${newMappedId}.`)
                value = value.replace(new RegExp(`<${blockRef}>`, 'g'), `<${newMappedId}>`)
              }
            }
          }
        }
        
        subBlocks[subBlock.id] = {
          id: subBlock.id,
          type: subBlock.type,
          value,
        }
      })

      newWorkflowState.blocks[newId] = {
        id: newId,
        type: block.type,
        name: block.name,
        position: block.position,
        subBlocks,
        outputs: blockConfig.outputs,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: 0,
        data: block.data || {},
      }
    }

    // Update parent-child relationships with mapped IDs
    for (const [newId, blockData] of Object.entries(newWorkflowState.blocks)) {
      const block = blockData as any
      if (block.data?.parentId) {
        const mappedParentId = blockIdMapping.get(block.data.parentId)
        if (mappedParentId) {
          logger.info(`[${requestId}] Updating parent reference: ${block.data.parentId} -> ${mappedParentId}`)
          block.data.parentId = mappedParentId
          // Ensure extent is set for child blocks
          if (!block.data.extent) {
            block.data.extent = 'parent'
          }
        } else {
          logger.warn(`[${requestId}] Parent block not found for mapping: ${block.data.parentId}`)
          // Remove invalid parent reference
          block.data.parentId = undefined
          block.data.extent = undefined
        }
      }
    }

    // Process edges with mapped IDs
    for (const edge of edges) {
      const sourceId = blockIdMapping.get(edge.source)
      const targetId = blockIdMapping.get(edge.target)

      if (sourceId && targetId) {
        newWorkflowState.edges.push({
          id: crypto.randomUUID(),
          source: sourceId,
          target: targetId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.type || 'default',
        })
      }
    }

    // Save to database
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, newWorkflowState)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save reverted workflow:`, saveResult.error)
      return NextResponse.json(
        {
          success: false,
          error: `Database save failed: ${saveResult.error || 'Unknown error'}`,
        },
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

    // Notify the socket server to tell clients to rehydrate stores from database
    try {
      const socketUrl = process.env.SOCKET_URL || 'http://localhost:3002'
      await fetch(`${socketUrl}/api/copilot-workflow-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId,
          description: `Reverted to checkpoint from ${new Date(checkpointData.createdAt).toLocaleString()}`,
        }),
      })
      logger.info(`[${requestId}] Notified socket server of checkpoint revert`)
    } catch (socketError) {
      logger.warn(`[${requestId}] Failed to notify socket server:`, socketError)
    }

    logger.info(`[${requestId}] Successfully reverted to checkpoint`)

    return NextResponse.json({
      success: true,
      message: `Successfully reverted to checkpoint from ${new Date(checkpointData.createdAt).toLocaleString()}`,
      summary: `Restored workflow with ${blocks.length} blocks and ${edges.length} connections.`,
      warnings,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error reverting checkpoint:`, error)
    return NextResponse.json(
      {
        error: `Failed to revert checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
