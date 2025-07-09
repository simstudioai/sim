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

// Copilot tools registry
const copilotTools: Record<string, CopilotTool> = {
  docs_search_internal: docsSearchTool,
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
