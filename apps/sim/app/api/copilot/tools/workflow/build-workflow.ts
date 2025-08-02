import { createLogger } from '@/lib/logs/console/logger'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { BaseCopilotTool } from '../base'

// Sim Agent API configuration
const SIM_AGENT_API_URL = process.env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY

interface BuildWorkflowParams {
  yamlContent: string
  description?: string
}

interface BuildWorkflowResult {
  yamlContent: string
  description?: string
  success: boolean
  message: string
  workflowState?: any
  data?: {
    blocksCount: number
    edgesCount: number
  }
}

class BuildWorkflowTool extends BaseCopilotTool<BuildWorkflowParams, BuildWorkflowResult> {
  readonly id = 'build_workflow'
  readonly displayName = 'Building workflow'

  protected async executeImpl(params: BuildWorkflowParams): Promise<BuildWorkflowResult> {
    return buildWorkflow(params)
  }
}

// Export the tool instance
export const buildWorkflowTool = new BuildWorkflowTool()

// Implementation function that builds workflow from YAML
async function buildWorkflow(params: BuildWorkflowParams): Promise<BuildWorkflowResult> {
  const logger = createLogger('BuildWorkflow')
  const { yamlContent, description } = params

  logger.info('Building workflow for copilot', {
    yamlLength: yamlContent.length,
    description,
  })

  try {
    // Convert YAML by calling sim-agent directly
    // Gather block registry and utilities
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

    const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/to-workflow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
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
          generateNewIds: true,
          preservePositions: false,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Sim agent API error: ${response.statusText}`)
    }

    const conversionResult = await response.json()

    if (!conversionResult.success || !conversionResult.workflowState) {
      logger.error('YAML conversion failed', {
        errors: conversionResult.errors,
        warnings: conversionResult.warnings,
      })
      return {
        success: false,
        message: `Failed to convert YAML workflow: ${conversionResult.errors.join(', ')}`,
        yamlContent,
        description,
      }
    }

    const { workflowState, idMapping } = conversionResult

    // Create a basic workflow state structure for preview
    const previewWorkflowState = {
      blocks: {} as Record<string, any>,
      edges: [] as any[],
      loops: {} as Record<string, any>,
      parallels: {} as Record<string, any>,
      lastSaved: Date.now(),
      isDeployed: false,
    }

    // Process blocks with preview IDs
    const blockIdMapping = new Map<string, string>()

    Object.keys(workflowState.blocks).forEach((blockId) => {
      const previewId = `preview-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
      blockIdMapping.set(blockId, previewId)
    })

    // Add blocks to preview workflow state
    for (const [originalId, block] of Object.entries(workflowState.blocks)) {
      const previewBlockId = blockIdMapping.get(originalId)!
      const typedBlock = block as any

      previewWorkflowState.blocks[previewBlockId] = {
        ...typedBlock,
        id: previewBlockId,
        position: typedBlock.position || { x: 0, y: 0 },
        enabled: true,
      }
    }

    // Process edges with updated block IDs
    previewWorkflowState.edges = workflowState.edges.map((edge: any) => ({
      ...edge,
      id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      source: blockIdMapping.get(edge.source) || edge.source,
      target: blockIdMapping.get(edge.target) || edge.target,
    }))

    const blocksCount = Object.keys(previewWorkflowState.blocks).length
    const edgesCount = previewWorkflowState.edges.length

    logger.info('Workflow built successfully', { blocksCount, edgesCount })

    return {
      success: true,
      message: `Successfully built workflow with ${blocksCount} blocks and ${edgesCount} connections`,
      yamlContent,
      description: description || 'Built workflow',
      workflowState: previewWorkflowState,
      data: {
        blocksCount,
        edgesCount,
      },
    }
  } catch (error) {
    logger.error('Failed to build workflow:', error)
    return {
      success: false,
      message: `Workflow build failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      yamlContent,
      description,
    }
  }
}
