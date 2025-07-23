import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { autoLayoutWorkflow } from '@/lib/autolayout/service'
import { createLogger } from '@/lib/logs/console-logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { generateWorkflowYaml } from '@/lib/workflows/yaml-generator'
import { getUserId as getOAuthUserId } from '@/app/api/auth/oauth/utils'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { db } from '@/db'
import { copilotCheckpoints, workflow as workflowTable } from '@/db/schema'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { convertYamlToWorkflow, parseWorkflowYaml } from '@/stores/workflows/yaml/importer'

const logger = createLogger('WorkflowYamlAPI')

// Request schema for YAML workflow operations
const YamlWorkflowRequestSchema = z.object({
  yamlContent: z.string().min(1, 'YAML content is required'),
  description: z.string().optional(),
  chatId: z.string().optional(), // For copilot checkpoints
  source: z.enum(['copilot', 'import', 'editor']).default('editor'),
  applyAutoLayout: z.boolean().default(true),
  createCheckpoint: z.boolean().default(false),
})

type YamlWorkflowRequest = z.infer<typeof YamlWorkflowRequestSchema>

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
      const currentYaml = generateWorkflowYaml(currentWorkflowData)

      // Create checkpoint
      await db.insert(copilotCheckpoints).values({
        userId,
        workflowId,
        chatId,
        yaml: currentYaml,
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
 * Helper function to get user ID with proper authentication for both tool calls and direct requests
 */
async function getUserId(requestId: string, workflowId: string): Promise<string | null> {
  // Use the OAuth utils function that handles both session and workflow-based auth
  const userId = await getOAuthUserId(requestId, workflowId)

  if (!userId) {
    logger.warn(`[${requestId}] Could not determine user ID for workflow ${workflowId}`)
    return null
  }

  // For additional security, verify the user has permission to access this workflow
  const workflowData = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .then((rows) => rows[0])

  if (!workflowData) {
    logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
    return null
  }

  // Check if user has permission to update this workflow
  let canUpdate = false

  // Case 1: User owns the workflow
  if (workflowData.userId === userId) {
    canUpdate = true
  }

  // Case 2: Workflow belongs to a workspace and user has write or admin permission
  if (!canUpdate && workflowData.workspaceId) {
    try {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowData.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canUpdate = true
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error checking workspace permissions:`, error)
    }
  }

  if (!canUpdate) {
    logger.warn(`[${requestId}] User ${userId} denied permission to update workflow ${workflowId}`)
    return null
  }

  return userId
}

/**
 * Helper function to update block references in values with new mapped IDs
 */
function updateBlockReferences(
  value: any,
  blockIdMapping: Map<string, string>,
  requestId: string
): any {
  if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
    let processedValue = value
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

    return processedValue
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => updateBlockReferences(item, blockIdMapping, requestId))
  }

  // Handle objects
  if (value !== null && typeof value === 'object') {
    const result = { ...value }
    for (const key in result) {
      result[key] = updateBlockReferences(result[key], blockIdMapping, requestId)
    }
    return result
  }

  return value
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

    // Parse YAML content
    const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(yamlContent)

    if (!yamlWorkflow || parseErrors.length > 0) {
      logger.error(`[${requestId}] YAML parsing failed`, { parseErrors })
      return NextResponse.json({
        success: false,
        message: 'Failed to parse YAML workflow',
        errors: parseErrors,
        warnings: [],
      })
    }

    // Convert YAML to workflow format
    const { blocks, edges, errors: convertErrors, warnings } = convertYamlToWorkflow(yamlWorkflow)

    if (convertErrors.length > 0) {
      logger.error(`[${requestId}] YAML conversion failed`, { convertErrors })
      return NextResponse.json({
        success: false,
        message: 'Failed to convert YAML to workflow',
        errors: convertErrors,
        warnings,
      })
    }

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
          height: 0,
          data: block.data || {},
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

        // Also ensure we have subBlocks for any YAML inputs that might not be in the config
        // This handles cases where hidden fields or dynamic configurations exist
        Object.keys(block.inputs).forEach((inputKey) => {
          if (!subBlocks[inputKey]) {
            subBlocks[inputKey] = {
              id: inputKey,
              type: 'short-input', // Default type for dynamic inputs
              value: null,
            }
          }
        })

        // Set up outputs from block configuration
        const outputs = resolveOutputType(blockConfig.outputs)

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

        logger.debug(`[${requestId}] Processed regular block: ${block.id} -> ${newId}`)
      } else {
        logger.warn(`[${requestId}] Unknown block type: ${block.type}`)
      }
    }

    // Set input values as subblock values with block reference mapping
    for (const block of blocks) {
      const newId = blockIdMapping.get(block.id)
      if (!newId || !newWorkflowState.blocks[newId]) continue

      if (block.inputs && typeof block.inputs === 'object') {
        Object.entries(block.inputs).forEach(([key, value]) => {
          if (newWorkflowState.blocks[newId].subBlocks[key]) {
            // Update block references in values to use new mapped IDs
            const processedValue = updateBlockReferences(value, blockIdMapping, requestId)
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

        newWorkflowState.blocks = layoutedBlocks
        logger.info(`[${requestId}] Autolayout completed successfully`)
      } catch (layoutError) {
        logger.warn(`[${requestId}] Autolayout failed, using original positions:`, layoutError)
      }
    }

    // Save to database
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, newWorkflowState)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow state:`, saveResult.error)
      return NextResponse.json({
        success: false,
        message: `Database save failed: ${saveResult.error || 'Unknown error'}`,
        errors: [saveResult.error || 'Database save failed'],
        warnings,
      })
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

    // Notify socket server for real-time collaboration (for copilot and editor)
    if (source === 'copilot' || source === 'editor') {
      try {
        const socketUrl = process.env.SOCKET_URL || 'http://localhost:3002'
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
      warnings,
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
