import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { workflow as workflowTable, workflowCheckpoints } from '@/db/schema'
import { getAllBlocks, getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { resolveOutputType } from '@/blocks/utils'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { simAgentClient } from '@/lib/sim-agent'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import { loadWorkflowFromNormalizedTables, saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'

const logger = createLogger('YamlWorkflowAPI')

const YamlWorkflowRequestSchema = z.object({
  yamlContent: z.string().min(1, 'YAML content is required'),
  description: z.string().optional(),
  chatId: z.string().optional(),
  source: z.enum(['copilot', 'editor', 'import']).default('editor'),
  applyAutoLayout: z.boolean().optional().default(false),
  createCheckpoint: z.boolean().optional().default(false),
})

function updateBlockReferences(
  value: any,
  blockIdMapping: Map<string, string>,
  requestId: string
): any {
  if (typeof value === 'string') {
    // Replace references in string values
    for (const [oldId, newId] of blockIdMapping.entries()) {
      if (value.includes(oldId)) {
        value = value
          .replaceAll(`<${oldId}.`, `<${newId}.`)
          .replaceAll(`%${oldId}.`, `%${newId}.`)
      }
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => updateBlockReferences(item, blockIdMapping, requestId))
  }

  if (value && typeof value === 'object') {
    const result: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = updateBlockReferences(val, blockIdMapping, requestId)
    }
    return result
  }

  return value
}

/**
 * Helper function to create a checkpoint before workflow changes
 */
async function createWorkflowCheckpoint(
  userId: string,
  workflowId: string,
  chatId: string,
  requestId: string
): Promise<boolean> {
  try {
    logger.info(`[${requestId}] Creating checkpoint before workflow edit`)

    // Get current workflow state
    const currentWorkflowData = await loadWorkflowFromNormalizedTables(workflowId)

    if (currentWorkflowData) {
      // Generate YAML from current state
      // Gather block registry and utilities for sim-agent
      const allBlockConfigs = getAllBlocks()
      const blockRegistry = allBlockConfigs.reduce(
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

      const generateResponse = await fetch(`${env.SIM_AGENT_API_URL}/api/workflow/to-yaml`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowState: currentWorkflowData,
          blockRegistry,
          utilities: {
            generateLoopBlocks: generateLoopBlocks.toString(),
            generateParallelBlocks: generateParallelBlocks.toString(),
            resolveOutputType: resolveOutputType.toString(),
          },
        }),
      })

      if (!generateResponse.ok) {
        const errorText = await generateResponse.text()
        throw new Error(`Failed to generate YAML: ${errorText}`)
      }

      const generateResult = await generateResponse.json()
      if (!generateResult.success || !generateResult.yaml) {
        throw new Error(generateResult.error || 'Failed to generate YAML')
      }
      const currentYaml = generateResult.yaml

      // Create checkpoint using new workflow_checkpoints table
      await db.insert(workflowCheckpoints).values({
        userId,
        workflowId,
        chatId,
        workflowState: currentWorkflowData, // Store JSON workflow state
      })

      logger.info(`[${requestId}] Checkpoint created successfully`)
      return true
    }
    logger.warn(`[${requestId}] Could not load current workflow state for checkpoint`)
    return false
  } catch (error) {
    logger.error(`[${requestId}] Failed to create checkpoint:`, error)
    return false
  }
}

/**
 * PUT /api/workflows/[id]/yaml
 * Consolidated YAML workflow saving endpoint
 * Handles copilot edits, imports, and text editor saves
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Parse and validate request
    const body = await request.json()
    const { yamlContent, description, chatId, source, applyAutoLayout, createCheckpoint } =
      YamlWorkflowRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing ${source} YAML workflow save`, {
      workflowId,
      yamlLength: yamlContent.length,
      hasDescription: !!description,
      hasChatId: !!chatId,
      applyAutoLayout,
      createCheckpoint,
    })

    // Get and validate user
    const userId = await getUserId(requestId, workflowId)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized or workflow not found' }, { status: 403 })
    }

    // Create checkpoint if requested (typically for copilot)
    if (createCheckpoint && chatId) {
      await createWorkflowCheckpoint(userId, workflowId, chatId, requestId)
    }

    // Convert YAML to workflow state by calling sim-agent directly
    // Gather block registry and utilities for sim-agent
    const allBlockTypes = getAllBlocks()
    const blockRegistry = allBlockTypes.reduce(
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

    const conversionResponse = await fetch(`${env.SIM_AGENT_API_URL}/api/yaml/to-workflow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        yamlContent,
        blockRegistry,
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
        },
        options: {
          generateNewIds: false, // We'll handle ID generation manually for now
          preservePositions: true,
        },
      }),
    })

    if (!conversionResponse.ok) {
      const errorText = await conversionResponse.text()
      logger.error(`[${requestId}] Sim agent API error:`, {
        status: conversionResponse.status,
        error: errorText,
      })
      return NextResponse.json({
        success: false,
        message: 'Failed to convert YAML to workflow',
        errors: [`Sim agent API error: ${conversionResponse.statusText}`],
        warnings: [],
      })
    }

    const conversionResult = await conversionResponse.json()

    if (!conversionResult.success || !conversionResult.workflowState) {
      logger.error(`[${requestId}] YAML conversion failed`, {
        errors: conversionResult.errors,
        warnings: conversionResult.warnings,
      })
      return NextResponse.json({
        success: false,
        message: 'Failed to convert YAML to workflow',
        errors: conversionResult.errors,
        warnings: conversionResult.warnings || [],
      })
    }

    const { workflowState } = conversionResult

    // Ensure all blocks have required fields
    Object.values(workflowState.blocks).forEach((block: any) => {
      if (block.enabled === undefined) {
        block.enabled = true
      }
      if (block.horizontalHandles === undefined) {
        block.horizontalHandles = true
      }
      if (block.isWide === undefined) {
        block.isWide = false
      }
      if (block.height === undefined) {
        block.height = 0
      }
      if (!block.subBlocks) {
        block.subBlocks = {}
      }
      if (!block.outputs) {
        block.outputs = {}
      }
    })

    const blocks = Object.values(workflowState.blocks) as Array<{
      id: string
      type: string
      name: string
      position: { x: number; y: number }
      subBlocks?: Record<string, any>
      data?: Record<string, any>
      parentId?: string
      extent?: string
    }>
    const edges = workflowState.edges
    const warnings = conversionResult.warnings || []

    // Create workflow state
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

    // Process blocks with proper configuration setup and assign new IDs
    const blockIdMapping = new Map<string, string>()

    for (const block of blocks) {
      const newId = crypto.randomUUID()
      blockIdMapping.set(block.id, newId)

      // Get block configuration for proper setup
      const blockConfig = getBlock(block.type)

      if (!blockConfig && (block.type === 'loop' || block.type === 'parallel')) {
        // Handle loop/parallel blocks (they don't have regular block configs)
        // Preserve parentId if it exists (though loop/parallel shouldn't have parents)
        const containerData = block.data || {}
        if (block.parentId) {
          containerData.parentId = block.parentId
          containerData.extent = block.extent || 'parent'
        }

        newWorkflowState.blocks[newId] = {
          id: newId,
          type: block.type,
          name: block.name,
          position: block.position,
          subBlocks: {},
          outputs: {},
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          height: 0,
          data: containerData,
        }
        logger.debug(`[${requestId}] Processed loop/parallel block: ${block.id} -> ${newId}`)
      } else if (blockConfig) {
        // Handle regular blocks with proper configuration
        const subBlocks: Record<string, any> = {}

        // Set up subBlocks from block configuration
        blockConfig.subBlocks.forEach((subBlock) => {
          subBlocks[subBlock.id] = {
            id: subBlock.id,
            type: subBlock.type,
            value: null,
          }
        })

        // Also ensure we have subBlocks for any existing subBlocks from conversion
        // This handles cases where hidden fields or dynamic configurations exist
        if (block.subBlocks) {
          Object.keys(block.subBlocks).forEach((subBlockKey) => {
            if (!subBlocks[subBlockKey]) {
              subBlocks[subBlockKey] = {
                id: subBlockKey,
                type: block.subBlocks![subBlockKey].type || 'short-input',
                value: block.subBlocks![subBlockKey].value || null,
              }
            }
          })
        }

        // Set up outputs from block configuration
        const outputs = resolveOutputType(blockConfig.outputs)

        // Preserve parentId if it exists in the imported block
        const blockData = block.data || {}
        if (block.parentId) {
          blockData.parentId = block.parentId
          blockData.extent = block.extent || 'parent'
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
          advancedMode: false,
          height: 0,
          data: blockData,
        }

        logger.debug(`[${requestId}] Processed regular block: ${block.id} -> ${newId}`)
      } else {
        logger.warn(`[${requestId}] Unknown block type: ${block.type}`)
      }
    }

    // Set subblock values with block reference mapping
    for (const block of blocks) {
      const newId = blockIdMapping.get(block.id)
      if (!newId || !newWorkflowState.blocks[newId]) continue

      if (block.subBlocks && typeof block.subBlocks === 'object') {
        Object.entries(block.subBlocks).forEach(([key, subBlock]: [string, any]) => {
          if (newWorkflowState.blocks[newId].subBlocks[key] && subBlock.value !== undefined) {
            // Update block references in values to use new mapped IDs
            const processedValue = updateBlockReferences(subBlock.value, blockIdMapping, requestId)
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

    // Process edges with mapped IDs and handles
    for (const edge of edges) {
      const sourceId = blockIdMapping.get(edge.source)
      const targetId = blockIdMapping.get(edge.target)

      if (sourceId && targetId) {
        const newEdgeId = crypto.randomUUID()
        newWorkflowState.edges.push({
          id: newEdgeId,
          source: sourceId,
          target: targetId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.type || 'default',
        })
      } else {
        logger.warn(
          `[${requestId}] Skipping edge - missing blocks: ${edge.source} -> ${edge.target}`
        )
      }
    }

    // Generate loop and parallel configurations
    const loops = generateLoopBlocks(newWorkflowState.blocks)
    const parallels = generateParallelBlocks(newWorkflowState.blocks)
    newWorkflowState.loops = loops
    newWorkflowState.parallels = parallels

    logger.info(`[${requestId}] Generated workflow state`, {
      blocksCount: Object.keys(newWorkflowState.blocks).length,
      edgesCount: newWorkflowState.edges.length,
      loopsCount: Object.keys(loops).length,
      parallelsCount: Object.keys(parallels).length,
    })

    // Apply intelligent autolayout if requested
    if (applyAutoLayout) {
      try {
        logger.info(`[${requestId}] Applying autolayout`)

        // Create workflow state for autolayout
        const workflowStateForLayout = {
          blocks: newWorkflowState.blocks,
          edges: newWorkflowState.edges,
          loops: newWorkflowState.loops || {},
          parallels: newWorkflowState.parallels || {},
        }

        const autoLayoutOptions = {
          strategy: 'smart' as const,
          direction: 'auto' as const,
          spacing: {
            horizontal: 500,
            vertical: 400,
            layer: 700,
          },
          alignment: 'center' as const,
          padding: {
            x: 250,
            y: 250,
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
            workflowState: workflowStateForLayout,
            options: autoLayoutOptions,
            blockRegistry,
            utilities: {
              generateLoopBlocks: generateLoopBlocks.toString(),
              generateParallelBlocks: generateParallelBlocks.toString(),
              resolveOutputType: resolveOutputType.toString(),
            },
          },
        })

        if (autoLayoutResult.success && autoLayoutResult.data?.workflowState) {
          newWorkflowState.blocks = autoLayoutResult.data.workflowState.blocks
        } else {
          logger.warn(
            `[${requestId}] Auto layout failed, using original positions:`,
            autoLayoutResult.error
          )
        }
        logger.info(`[${requestId}] Autolayout completed successfully`)
      } catch (layoutError) {
        logger.warn(`[${requestId}] Autolayout failed, using original positions:`, layoutError)
      }
    }

    // Sanitize custom tools in agent blocks before saving
    const { blocks: sanitizedBlocks, warnings: sanitationWarnings } = sanitizeAgentToolsInBlocks(
      newWorkflowState.blocks
    )
    if (sanitationWarnings.length > 0) {
      logger.warn(
        `[${requestId}] Tool sanitation produced ${sanitationWarnings.length} warning(s)`
      )
    }
    newWorkflowState.blocks = sanitizedBlocks

    // Save to database
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, newWorkflowState)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow state:`, saveResult.error)
      return NextResponse.json({
        success: false,
        message: `Database save failed: ${saveResult.error || 'Unknown error'}`,
        errors: [saveResult.error || 'Database save failed'],
        warnings: [...warnings, ...sanitationWarnings],
      })
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflowTable)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowTable.id, workflowId))

    // Notify socket server for real-time collaboration (for copilot and editor)
    if (source === 'copilot' || source === 'editor') {
      try {
        const socketUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
        await fetch(`${socketUrl}/api/copilot-workflow-edit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId,
            description: description || `${source} edited workflow`,
          }),
        })
        logger.info(`[${requestId}] Notified socket server`)
      } catch (socketError) {
        logger.warn(`[${requestId}] Failed to notify socket server:`, socketError)
      }
    }

    const elapsed = Date.now() - startTime
    const totalBlocksInWorkflow = Object.keys(newWorkflowState.blocks).length
    const summary = `Successfully saved workflow with ${totalBlocksInWorkflow} blocks and ${newWorkflowState.edges.length} connections.`

    logger.info(`[${requestId}] YAML workflow save completed in ${elapsed}ms`, {
      success: true,
      blocksCount: totalBlocksInWorkflow,
      edgesCount: newWorkflowState.edges.length,
    })

    return NextResponse.json({
      success: true,
      message: description ? `Workflow updated: ${description}` : 'Workflow updated successfully',
      summary,
      data: {
        blocksCount: totalBlocksInWorkflow,
        edgesCount: newWorkflowState.edges.length,
        loopsCount: Object.keys(loops).length,
        parallelsCount: Object.keys(parallels).length,
      },
      errors: [],
      warnings: [...warnings, ...sanitationWarnings],
    })
  } catch (error) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] YAML workflow save failed in ${elapsed}ms:`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid request data',
          errors: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
          warnings: [],
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        message: `Failed to save YAML workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        warnings: [],
      },
      { status: 500 }
    )
  }
}
