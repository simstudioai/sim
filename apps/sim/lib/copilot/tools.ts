import { createLogger } from '@/lib/logs/console-logger'
import { searchDocumentation } from './service'

const logger = createLogger('CopilotTools')

// Interface for copilot tool execution results
export interface CopilotToolResult {
  success: boolean
  data?: any
  error?: string
}

// Interface for copilot tool definitions
export interface CopilotTool {
  id: string
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
  execute: (args: Record<string, any>) => Promise<CopilotToolResult>
}

// Documentation search tool for copilot
const docsSearchTool: CopilotTool = {
  id: 'docs_search_internal',
  name: 'Search Documentation',
  description:
    'Search Sim Studio documentation for information about features, tools, workflows, and functionality',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant documentation',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 10)',
        default: 5,
      },
    },
    required: ['query'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { query, topK = 5 } = args

      logger.info('Executing documentation search', { query, topK })

      const results = await searchDocumentation(query, { topK })

      logger.info(`Found ${results.length} documentation results`, { query })

      return {
        success: true,
        data: {
          results,
          query,
          totalResults: results.length,
        },
      }
    } catch (error) {
      logger.error('Documentation search failed', error)
      return {
        success: false,
        error: `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

// Get user workflow as YAML tool for copilot
const getUserWorkflowTool: CopilotTool = {
  id: 'get_user_workflow',
  name: 'Get User Workflow',
  description:
    'Get the current user workflow as YAML format. This shows all blocks, their configurations, inputs, and connections in the workflow.',
  parameters: {
    type: 'object',
    properties: {
      includeMetadata: {
        type: 'boolean',
        description: 'Whether to include additional metadata about the workflow (default: false)',
        default: false,
      },
    },
    required: [],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { includeMetadata = false } = args

      logger.info('Executing get user workflow', { includeMetadata })

      // Import the workflow YAML store dynamically to avoid import issues
      const { useWorkflowYamlStore } = await import('@/stores/workflows/yaml/store')
      const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')
      
      // Get the current workflow YAML
      const yamlContent = useWorkflowYamlStore.getState().getYaml()
      
      // Get additional metadata if requested
      let metadata = {}
      if (includeMetadata) {
        const registry = useWorkflowRegistry.getState()
        const activeWorkflowId = registry.activeWorkflowId
        const activeWorkflow = activeWorkflowId ? registry.workflows[activeWorkflowId] : null
        
        if (activeWorkflow) {
          metadata = {
            workflowId: activeWorkflowId,
            name: activeWorkflow.name,
            description: activeWorkflow.description,
            lastModified: activeWorkflow.lastModified,
            workspaceId: activeWorkflow.workspaceId,
          }
        }
      }

      logger.info('Successfully retrieved user workflow YAML')

      return {
        success: true,
        data: {
          yaml: yamlContent,
          metadata: includeMetadata ? metadata : undefined,
        },
      }
    } catch (error) {
      logger.error('Get user workflow failed', error)
      return {
        success: false,
        error: `Failed to get user workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

// Copilot tools registry
const copilotTools: Record<string, CopilotTool> = {
  docs_search_internal: docsSearchTool,
  get_user_workflow: getUserWorkflowTool,
}

// Get a copilot tool by ID
export function getCopilotTool(toolId: string): CopilotTool | undefined {
  return copilotTools[toolId]
}

// Execute a copilot tool
export async function executeCopilotTool(
  toolId: string,
  args: Record<string, any>
): Promise<CopilotToolResult> {
  const tool = getCopilotTool(toolId)

  if (!tool) {
    logger.error(`Copilot tool not found: ${toolId}`)
    return {
      success: false,
      error: `Tool not found: ${toolId}`,
    }
  }

  try {
    logger.info(`Executing copilot tool: ${toolId}`, { args })
    const result = await tool.execute(args)
    logger.info(`Copilot tool execution completed: ${toolId}`, { success: result.success })
    return result
  } catch (error) {
    logger.error(`Copilot tool execution failed: ${toolId}`, error)
    return {
      success: false,
      error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

// Get all available copilot tools (for tool definitions in LLM requests)
export function getAllCopilotTools(): CopilotTool[] {
  return Object.values(copilotTools)
}
