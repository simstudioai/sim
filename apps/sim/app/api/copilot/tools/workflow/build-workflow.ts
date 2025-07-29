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
    // Import the unified converter
    const { convertYamlToWorkflowState } = await import('@/lib/workflows/yaml-converter')
    
    // Use unified conversion with new IDs generation
    const conversionResult = await convertYamlToWorkflowState(yamlContent, {
      generateNewIds: true,
      preservePositions: false
    })

    if (!conversionResult.success || !conversionResult.workflowState) {
      logger.error('YAML conversion failed', { 
        errors: conversionResult.errors,
        warnings: conversionResult.warnings 
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
      
      previewWorkflowState.blocks[previewBlockId] = {
        ...block,
        id: previewBlockId,
        position: (block as any).position || { x: 0, y: 0 },
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