import { createLogger } from '@/lib/logs/console-logger'
import { BaseCopilotTool } from '../base'

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
    // Import the necessary functions dynamically to avoid import issues
    const { parseWorkflowYaml } = await import('@/stores/workflows/yaml/importer')
    const { convertYamlToWorkflow } = await import('@/stores/workflows/yaml/importer')
    
    // Parse YAML content
    const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(yamlContent)

    if (!yamlWorkflow || parseErrors.length > 0) {
      logger.error('YAML parsing failed', { parseErrors })
      return {
        success: false,
        message: `Failed to parse YAML workflow: ${parseErrors.join(', ')}`,
        yamlContent,
        description,
      }
    }

    // Convert YAML to workflow format
    const { blocks, edges, errors: convertErrors } = convertYamlToWorkflow(yamlWorkflow)

    if (convertErrors.length > 0) {
      logger.error('YAML conversion failed', { convertErrors })
      return {
        success: false,
        message: `Failed to convert YAML to workflow: ${convertErrors.join(', ')}`,
        yamlContent,
        description,
      }
    }

    // Create a basic workflow state structure
    const workflowState = {
      blocks: {} as Record<string, any>,
      edges: [] as any[],
      loops: {} as Record<string, any>,
      parallels: {} as Record<string, any>,
      lastSaved: Date.now(),
      isDeployed: false,
    }

    // Process blocks with unique IDs
    const blockIdMapping = new Map<string, string>()
    
    Object.keys(blocks).forEach((blockId) => {
      const previewId = `preview-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
      blockIdMapping.set(blockId, previewId)
    })

    // Add blocks to workflow state
    for (const [originalBlockId, blockData] of Object.entries(blocks)) {
      const previewBlockId = blockIdMapping.get(originalBlockId)!
      
      workflowState.blocks[previewBlockId] = {
        ...blockData,
        id: previewBlockId,
        position: (blockData as any).position || { x: 0, y: 0 },
        enabled: true,
      }
    }

    // Process edges with updated block IDs
    workflowState.edges = edges.map((edge: any) => ({
      ...edge,
      id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      source: blockIdMapping.get(edge.source) || edge.source,
      target: blockIdMapping.get(edge.target) || edge.target,
    }))

    const blocksCount = Object.keys(workflowState.blocks).length
    const edgesCount = workflowState.edges.length
    
    logger.info('Workflow built successfully', { blocksCount, edgesCount })

    return {
      success: true,
      message: `Successfully built workflow with ${blocksCount} blocks and ${edgesCount} connections`,
      yamlContent,
      description: description || 'Built workflow',
      workflowState,
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