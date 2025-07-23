import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { autoLayoutWorkflow } from '@/lib/autolayout/service'
import { createLogger } from '@/lib/logs/console-logger'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { generateWorkflowYaml } from '@/lib/workflows/yaml-generator'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { getBlock } from '@/blocks'
import { db } from '@/db'
import { copilotCheckpoints, workflow as workflowTable } from '@/db/schema'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { convertYamlToWorkflow, parseWorkflowYaml } from '@/stores/workflows/yaml/importer'

const logger = createLogger('EditWorkflowAPI')

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { yamlContent, workflowId, description, chatId } = body

    if (!yamlContent) {
      return NextResponse.json(
        { success: false, error: 'yamlContent is required' },
        { status: 400 }
      )
    }

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Processing workflow edit request`, {
      workflowId,
      yamlLength: yamlContent.length,
      hasDescription: !!description,
      hasChatId: !!chatId,
    })

    // Log the full YAML content for debugging
    logger.info(`[${requestId}] Full YAML content from copilot:`)
    logger.info('='.repeat(80))
    logger.info(yamlContent)
    logger.info('='.repeat(80))

    // Get the user ID for checkpoint creation
    const userId = await getUserId(requestId, workflowId)
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    // Create checkpoint before making changes (only if chatId is provided)
    if (chatId) {
      try {
        logger.info(`[${requestId}] Creating checkpoint before workflow edit`)

        // Get current workflow state
        const currentWorkflowData = await loadWorkflowFromNormalizedTables(workflowId)

        if (currentWorkflowData) {
          // Generate YAML from current state
          const currentYaml = generateWorkflowYaml(currentWorkflowData)

          // Create checkpoint
          await db.insert(copilotCheckpoints).values({
            userId,
            workflowId,
            chatId,
            yaml: currentYaml,
          })

          logger.info(`[${requestId}] Checkpoint created successfully`)
        } else {
          logger.warn(`[${requestId}] Could not load current workflow state for checkpoint`)
        }
      } catch (checkpointError) {
        logger.error(`[${requestId}] Failed to create checkpoint:`, checkpointError)
        // Continue with workflow edit even if checkpoint fails
      }
    }

    // Parse YAML content server-side
    const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(yamlContent)

    if (!yamlWorkflow || parseErrors.length > 0) {
      logger.error('[edit-workflow] YAML parsing failed', { parseErrors })
      return NextResponse.json({
        success: true,
        data: {
          success: false,
          message: 'Failed to parse YAML workflow',
          errors: parseErrors,
          warnings: [],
        },
      })
    }

    // Convert YAML to workflow format
    const { blocks, edges, errors: convertErrors, warnings } = convertYamlToWorkflow(yamlWorkflow)

    if (convertErrors.length > 0) {
      logger.error('[edit-workflow] YAML conversion failed', { convertErrors })
      return NextResponse.json({
        success: true,
        data: {
          success: false,
          message: 'Failed to convert YAML to workflow',
          errors: convertErrors,
          warnings,
        },
      })
    }

    // Create workflow state (same format as applyWorkflowDiff)
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

    // Process blocks and assign new IDs (complete replacement)
    const blockIdMapping = new Map<string, string>()

    for (const block of blocks) {
      const newId = crypto.randomUUID()
      blockIdMapping.set(block.id, newId)

      // Get block configuration to set proper defaults
      const blockConfig = getBlock(block.type)
      const subBlocks: Record<string, any> = {}
      const outputs: Record<string, any> = {}

      // Set up subBlocks from block configuration
      if (blockConfig?.subBlocks) {
        blockConfig.subBlocks.forEach((subBlock) => {
          subBlocks[subBlock.id] = {
            id: subBlock.id,
            type: subBlock.type,
            value: null,
          }
        })
      }

      // Set up outputs from block configuration
      if (blockConfig?.outputs) {
        if (Array.isArray(blockConfig.outputs)) {
          blockConfig.outputs.forEach((output) => {
            outputs[output.id] = { type: output.type }
          })
        } else if (typeof blockConfig.outputs === 'object') {
          Object.assign(outputs, blockConfig.outputs)
        }
      }

      newWorkflowState.blocks[newId] = {
        id: newId,
        type: block.type,
        name: block.name,
        position: block.position,
        subBlocks,
        outputs,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: 0,
        data: block.data || {},
      }

      // Set input values as subblock values with block reference mapping
      if (block.inputs && typeof block.inputs === 'object') {
        Object.entries(block.inputs).forEach(([key, value]) => {
          if (newWorkflowState.blocks[newId].subBlocks[key]) {
            // Update block references in values to use new mapped IDs
            let processedValue = value
            if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
              // Update block references to use new mapped IDs
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
                    logger.info(
                      `[${requestId}] Updating block reference: ${blockRef} -> ${newMappedId}`
                    )
                    processedValue = processedValue.replace(
                      new RegExp(`<${blockRef}\\.`, 'g'),
                      `<${newMappedId}.`
                    )
                    processedValue = processedValue.replace(
                      new RegExp(`<${blockRef}>`, 'g'),
                      `<${newMappedId}>`
                    )
                  }
                }
              }
            }
            newWorkflowState.blocks[newId].subBlocks[key].value = processedValue
          }
        })
      }
    }

    // Update parent-child relationships with mapped IDs
    logger.info(`[${requestId}] Block ID mapping:`, Object.fromEntries(blockIdMapping))
    for (const [newId, blockData] of Object.entries(newWorkflowState.blocks)) {
      const block = blockData as any
      if (block.data?.parentId) {
        logger.info(
          `[${requestId}] Found child block ${block.name} with parentId: ${block.data.parentId}`
        )
        const mappedParentId = blockIdMapping.get(block.data.parentId)
        if (mappedParentId) {
          logger.info(
            `[${requestId}] Updating parent reference: ${block.data.parentId} -> ${mappedParentId}`
          )
          block.data.parentId = mappedParentId
          // Ensure extent is set for child blocks
          if (!block.data.extent) {
            block.data.extent = 'parent'
          }
        } else {
          logger.error(
            `[${requestId}] ❌ Parent block not found for mapping: ${block.data.parentId}`
          )
          logger.error(`[${requestId}] Available mappings:`, Array.from(blockIdMapping.keys()))
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

    // Generate loop and parallel configurations from the imported blocks
    const loops = generateLoopBlocks(newWorkflowState.blocks)
    const parallels = generateParallelBlocks(newWorkflowState.blocks)

    // Update workflow state with generated configurations
    newWorkflowState.loops = loops
    newWorkflowState.parallels = parallels

    logger.info(`[${requestId}] Generated loop and parallel configurations`, {
      loopsCount: Object.keys(loops).length,
      parallelsCount: Object.keys(parallels).length,
      loopIds: Object.keys(loops),
      parallelIds: Object.keys(parallels),
    })

    // Apply intelligent autolayout to optimize block positions
    try {
      logger.info(
        `[${requestId}] Applying autolayout to ${Object.keys(newWorkflowState.blocks).length} blocks`
      )

      const layoutedBlocks = await autoLayoutWorkflow(
        newWorkflowState.blocks,
        newWorkflowState.edges,
        {
          strategy: 'smart',
          direction: 'auto',
          spacing: {
            horizontal: 400,
            vertical: 200,
            layer: 600,
          },
          alignment: 'center',
          padding: {
            x: 200,
            y: 200,
          },
        }
      )

      // Update workflow state with optimized positions
      newWorkflowState.blocks = layoutedBlocks

      logger.info(`[${requestId}] Autolayout completed successfully`)
    } catch (layoutError) {
      // Log the error but don't fail the entire workflow save
      logger.warn(`[${requestId}] Autolayout failed, using original positions:`, layoutError)
    }

    // Save directly to database using the same function as the workflow state API
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, newWorkflowState)

    if (!saveResult.success) {
      logger.error('[edit-workflow] Failed to save workflow state:', saveResult.error)
      return NextResponse.json({
        success: true,
        data: {
          success: false,
          message: `Database save failed: ${saveResult.error || 'Unknown error'}`,
          errors: [saveResult.error || 'Database save failed'],
          warnings,
        },
      })
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflowTable)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
        state: saveResult.jsonBlob, // Also update JSON blob for backward compatibility
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
          description: description || 'Copilot edited workflow',
        }),
      })
      logger.info('[edit-workflow] Notified socket server to rehydrate client stores from database')
    } catch (socketError) {
      // Don't fail the main request if socket notification fails
      logger.warn('[edit-workflow] Failed to notify socket server:', socketError)
    }

    // Calculate summary with loop/parallel information
    const loopBlocksCount = Object.values(newWorkflowState.blocks).filter(
      (b: any) => b.type === 'loop'
    ).length
    const parallelBlocksCount = Object.values(newWorkflowState.blocks).filter(
      (b: any) => b.type === 'parallel'
    ).length

    let summaryDetails = `Successfully created workflow with ${blocks.length} blocks and ${edges.length} connections.`

    if (loopBlocksCount > 0 || parallelBlocksCount > 0) {
      summaryDetails += ` Generated ${Object.keys(loops).length} loop configurations and ${Object.keys(parallels).length} parallel configurations.`
    }

    const result = {
      success: true,
      errors: [],
      warnings,
      summary: summaryDetails,
    }

    logger.info('[edit-workflow] Import result', {
      success: result.success,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      summary: result.summary,
    })

    return NextResponse.json({
      success: true,
      data: {
        success: result.success,
        message: result.success
          ? `Workflow updated successfully${description ? `: ${description}` : ''}`
          : 'Failed to update workflow',
        summary: result.summary,
        errors: result.errors,
        warnings: result.warnings,
      },
    })
  } catch (error) {
    logger.error('[edit-workflow] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to edit workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
