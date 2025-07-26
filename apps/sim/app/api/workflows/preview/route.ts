import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { autoLayoutWorkflow } from '@/lib/autolayout/service'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { convertYamlToWorkflow, parseWorkflowYaml } from '@/stores/workflows/yaml/importer'

const logger = createLogger('WorkflowPreviewAPI')

// Request schema for workflow preview operations
const WorkflowPreviewRequestSchema = z.object({
  yamlContent: z.string().min(1, 'YAML content is required'),
  applyAutoLayout: z.boolean().default(true),
})

type WorkflowPreviewRequest = z.infer<typeof WorkflowPreviewRequestSchema>

/**
 * POST /api/workflows/preview
 * Generate a workflow preview from YAML content without saving to database
 * This is used by the copilot sandbox to show workflow previews
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    // Parse and validate request
    const body = await request.json()
    const { yamlContent, applyAutoLayout } = WorkflowPreviewRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing workflow preview request`, {
      yamlLength: yamlContent.length,
      applyAutoLayout,
    })

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

    // Create workflow state for preview
    const previewWorkflowState: any = {
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

    // Process blocks and assign preview IDs
    const blockIdMapping = new Map<string, string>()

    for (const block of blocks) {
      const newId = crypto.randomUUID()
      blockIdMapping.set(block.id, newId)

      // Handle different block types
      if (block.type === 'loop') {
        const loopBlocks = generateLoopBlocks({ [newId]: block } as any)
        previewWorkflowState.loops = { ...previewWorkflowState.loops, ...loopBlocks }

        // Get block config and populate subBlocks with YAML input values
        const blockConfig = getBlock(block.type)
        const subBlocks: Record<string, any> = {}

        if (blockConfig) {
          // Set up subBlocks from block configuration
          blockConfig.subBlocks.forEach((subBlock) => {
            const yamlValue = block.inputs[subBlock.id]
            subBlocks[subBlock.id] = {
              id: subBlock.id,
              type: subBlock.type,
              value: yamlValue !== undefined ? yamlValue : null,
            }
          })

          // Also ensure we have subBlocks for any YAML inputs not in block config
          Object.keys(block.inputs).forEach((inputKey) => {
            if (!subBlocks[inputKey]) {
              subBlocks[inputKey] = {
                id: inputKey,
                type: 'short-input',
                value: block.inputs[inputKey],
              }
            }
          })
        }

        previewWorkflowState.blocks[newId] = {
          id: newId,
          type: 'loop',
          name: block.name,
          position: block.position || { x: 0, y: 0 },
          subBlocks,
          outputs: {},
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          data: block.data || {},
        }
      } else if (block.type === 'parallel') {
        const parallelBlocks = generateParallelBlocks({ [newId]: block } as any)
        previewWorkflowState.parallels = { ...previewWorkflowState.parallels, ...parallelBlocks }

        // Get block config and populate subBlocks with YAML input values
        const blockConfig = getBlock(block.type)
        const subBlocks: Record<string, any> = {}

        if (blockConfig) {
          // Set up subBlocks from block configuration
          blockConfig.subBlocks.forEach((subBlock) => {
            const yamlValue = block.inputs[subBlock.id]
            subBlocks[subBlock.id] = {
              id: subBlock.id,
              type: subBlock.type,
              value: yamlValue !== undefined ? yamlValue : null,
            }
          })

          // Also ensure we have subBlocks for any YAML inputs not in block config
          Object.keys(block.inputs).forEach((inputKey) => {
            if (!subBlocks[inputKey]) {
              subBlocks[inputKey] = {
                id: inputKey,
                type: 'short-input',
                value: block.inputs[inputKey],
              }
            }
          })
        }

        previewWorkflowState.blocks[newId] = {
          id: newId,
          type: 'parallel',
          name: block.name,
          position: block.position || { x: 0, y: 0 },
          subBlocks,
          outputs: {},
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          data: block.data || {},
        }
      } else {
        // Handle regular blocks
        const blockConfig = getBlock(block.type)
        if (blockConfig) {
          const subBlocks: Record<string, any> = {}

          // Set up subBlocks from block configuration
          blockConfig.subBlocks.forEach((subBlock) => {
            // Use the actual value from YAML inputs if available
            const yamlValue = block.inputs[subBlock.id]
            subBlocks[subBlock.id] = {
              id: subBlock.id,
              type: subBlock.type,
              value: yamlValue !== undefined ? yamlValue : null,
            }
          })

          // Also ensure we have subBlocks for any YAML inputs not in block config
          Object.keys(block.inputs).forEach((inputKey) => {
            if (!subBlocks[inputKey]) {
              subBlocks[inputKey] = {
                id: inputKey,
                type: 'short-input',
                value: block.inputs[inputKey],
              }
            }
          })

          // Set up outputs from block configuration
          const outputs = resolveOutputType(blockConfig.outputs)

          previewWorkflowState.blocks[newId] = {
            id: newId,
            type: block.type,
            name: block.name,
            position: block.position || { x: 0, y: 0 },
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
    }

    // Process edges with mapped IDs
    for (const edge of edges) {
      const sourceId = blockIdMapping.get(edge.source)
      const targetId = blockIdMapping.get(edge.target)

      if (sourceId && targetId) {
        const newEdgeId = crypto.randomUUID()
        previewWorkflowState.edges.push({
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
    const loops = generateLoopBlocks(previewWorkflowState.blocks)
    const parallels = generateParallelBlocks(previewWorkflowState.blocks)
    previewWorkflowState.loops = loops
    previewWorkflowState.parallels = parallels

    logger.info(`[${requestId}] Generated preview workflow state`, {
      blocksCount: Object.keys(previewWorkflowState.blocks).length,
      edgesCount: previewWorkflowState.edges.length,
      loopsCount: Object.keys(loops).length,
      parallelsCount: Object.keys(parallels).length,
    })

    // Apply intelligent autolayout if requested
    if (applyAutoLayout) {
      try {
        logger.info(`[${requestId}] Applying autolayout to preview`)

        const layoutedBlocks = await autoLayoutWorkflow(
          previewWorkflowState.blocks,
          previewWorkflowState.edges,
          {
            strategy: 'smart',
            direction: 'auto',
            spacing: {
              horizontal: 500,
              vertical: 400,
              layer: 700,
            },
            alignment: 'center',
            padding: {
              x: 250,
              y: 250,
            },
          }
        )

        previewWorkflowState.blocks = layoutedBlocks
        logger.info(`[${requestId}] Autolayout completed successfully for preview`)
      } catch (layoutError) {
        logger.warn(
          `[${requestId}] Autolayout failed for preview, using original positions:`,
          layoutError
        )
      }
    }

    const elapsed = Date.now() - startTime
    const totalBlocksInWorkflow = Object.keys(previewWorkflowState.blocks).length
    const summary = `Successfully generated preview with ${totalBlocksInWorkflow} blocks and ${previewWorkflowState.edges.length} connections.`

    logger.info(`[${requestId}] Workflow preview completed in ${elapsed}ms`, {
      success: true,
      blocksCount: totalBlocksInWorkflow,
      edgesCount: previewWorkflowState.edges.length,
    })

    return NextResponse.json({
      success: true,
      message: 'Workflow preview generated successfully',
      summary,
      workflowState: previewWorkflowState,
      data: {
        blocksCount: totalBlocksInWorkflow,
        edgesCount: previewWorkflowState.edges.length,
        loopsCount: Object.keys(loops).length,
        parallelsCount: Object.keys(parallels).length,
      },
      errors: [],
      warnings,
    })
  } catch (error) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Workflow preview failed in ${elapsed}ms:`, error)

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
        message: `Failed to generate workflow preview: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        warnings: [],
      },
      { status: 500 }
    )
  }
}
