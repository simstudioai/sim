import { searchDocumentation } from '@/lib/copilot/service'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowYamlStore } from '@/stores/workflows/yaml/store'

const logger = createLogger('CopilotTools')

/**
 * Interface for copilot tool execution results
 */
export interface CopilotToolResult {
  success: boolean
  data?: any
  error?: string
}

/**
 * Interface for copilot tool parameters
 */
export interface CopilotToolParameters {
  type: 'object'
  properties: Record<string, any>
  required: string[]
}

/**
 * Interface for copilot tool definitions
 */
export interface CopilotTool {
  id: string
  name: string
  description: string
  parameters: CopilotToolParameters
  execute: (args: Record<string, any>) => Promise<CopilotToolResult>
}

/**
 * Interface for documentation search arguments
 */
interface DocsSearchArgs {
  query: string
  topK?: number
}

/**
 * Interface for workflow metadata
 */
interface WorkflowMetadata {
  workflowId: string
  name: string
  description: string | undefined
  workspaceId: string
}

/**
 * Interface for user workflow data
 */
interface UserWorkflowData {
  yaml: string
  metadata?: WorkflowMetadata
}

/**
 * Documentation search tool for copilot
 */
const docsSearchTool: CopilotTool = {
  id: 'docs_search_internal',
  name: 'Search Documentation',
  description:
    'Search Sim documentation for information about features, tools, workflows, and functionality',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant documentation',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default: 10, max: 10)',
        default: 10,
      },
    },
    required: ['query'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { query, topK = 10 } = args
      const results = await searchDocumentation(query, { topK })

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

/**
 * Get user workflow as YAML tool for copilot
 */
const getUserWorkflowTool: CopilotTool = {
  id: 'get_user_workflow',
  name: 'Get User Workflow',
  description:
    'Get the current user workflow as YAML format. This shows all blocks, their configurations, inputs, and connections in the workflow.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      // Get the current workflow YAML using the same logic as export
      const yamlContent = useWorkflowYamlStore.getState().getYaml()

      // Get workflow metadata
      const registry = useWorkflowRegistry.getState()
      const activeWorkflowId = registry.activeWorkflowId
      const activeWorkflow = activeWorkflowId ? registry.workflows[activeWorkflowId] : null

      let metadata: WorkflowMetadata | undefined
      if (activeWorkflow && activeWorkflowId) {
        metadata = {
          workflowId: activeWorkflowId,
          name: activeWorkflow.name || 'Untitled Workflow',
          description: activeWorkflow.description,
          workspaceId: activeWorkflow.workspaceId || '',
        }
      }

      const data: UserWorkflowData = {
        yaml: yamlContent,
        metadata,
      }

      return {
        success: true,
        data,
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

/**
 * Copilot tools registry
 */
const copilotTools: Record<string, CopilotTool> = {
  docs_search_internal: docsSearchTool,
  get_user_workflow: getUserWorkflowTool,
}

/**
 * Get a copilot tool by ID
 */
export function getCopilotTool(toolId: string): CopilotTool | undefined {
  return copilotTools[toolId]
}

/**
 * Execute a copilot tool
 */
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
    const result = await tool.execute(args)
    return result
  } catch (error) {
    logger.error(`Copilot tool execution failed: ${toolId}`, error)
    return {
      success: false,
      error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * Get all available copilot tools (for tool definitions in LLM requests)
 */
export function getAllCopilotTools(): CopilotTool[] {
  return Object.values(copilotTools)
}
