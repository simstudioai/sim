import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('McpBlockHandler')

/**
 * Handler for MCP blocks that execute tools on Model Context Protocol servers.
 * This handler directly calls the MCP API instead of going through the tool framework.
 */
export class McpBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.MCP
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    logger.info(`Executing MCP block: ${block.id}`)

    // Extract MCP parameters from block config (serialized params)
    const blockParams = block.config.params || {}

    // Get server and tool selection from the block configuration
    const serverId = blockParams.serverId || blockParams.server || inputs.server
    const toolName = blockParams.toolName || blockParams.tool || inputs.tool
    const toolArguments = blockParams.arguments || inputs.arguments || {}

    // If we have a tool selection but no explicit serverId, extract it from the tool ID
    // Tool IDs are in format: "mcp-{timestamp}-{toolName}"
    if (toolName && typeof toolName === 'string' && !serverId) {
      const match = toolName.match(/^(mcp-\d+)-(.+)$/)
      if (match) {
        const extractedServerId = match[1] // "mcp-1757367082645"
        const extractedToolName = match[2] // "web_search_exa"
        return this.executeWithParams(extractedServerId, extractedToolName, toolArguments)
      }
    }

    if (!serverId) {
      throw new Error('serverId is required for MCP tool execution')
    }

    if (!toolName) {
      throw new Error('toolName is required for MCP tool execution')
    }

    return this.executeWithParams(serverId, toolName, toolArguments)
  }

  private async executeWithParams(
    serverId: string,
    toolName: string,
    toolArguments: any
  ): Promise<any> {
    // Parse arguments - handle both string JSON and object formats
    let parsedArguments = {}
    if (toolArguments) {
      if (typeof toolArguments === 'string') {
        try {
          parsedArguments = JSON.parse(toolArguments)
        } catch (error) {
          logger.warn('Failed to parse MCP arguments as JSON:', toolArguments)
          parsedArguments = {}
        }
      } else if (typeof toolArguments === 'object') {
        parsedArguments = toolArguments
      }
    }

    // Check if we're on the client side
    if (typeof window !== 'undefined') {
      // Client-side execution - make API call
      return this.executeClientSide(serverId, toolName, parsedArguments)
    }
    // Server-side execution - use MCP service directly
    return this.executeServerSide(serverId, toolName, parsedArguments)
  }

  private async executeClientSide(
    serverId: string,
    toolName: string,
    parsedArguments: any
  ): Promise<any> {
    try {
      logger.info(
        `Client-side: Making API call to execute MCP tool ${toolName} on server ${serverId}`
      )

      const response = await fetch('/api/mcp/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serverId,
          toolCall: {
            name: toolName,
            arguments: parsedArguments,
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const result = await response.json()
      logger.info(`Client-side: Successfully executed MCP tool ${toolName} on server ${serverId}`)

      return {
        success: true,
        output: result,
      }
    } catch (error) {
      logger.error(`Client-side: Failed to execute MCP tool ${toolName} on server ${serverId}:`, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async executeServerSide(
    serverId: string,
    toolName: string,
    parsedArguments: any
  ): Promise<any> {
    try {
      logger.info(
        `Server-side: Executing MCP tool ${toolName} on server ${serverId} with arguments:`,
        parsedArguments
      )

      // For server-side execution, we need a userId. In this context, we might not have it.
      // This is a limitation - we may need to pass it through the execution context
      // For now, we'll throw an error indicating this needs to be handled at the API level
      throw new Error(
        'Server-side MCP execution requires authentication context. Use API endpoint instead.'
      )
    } catch (error) {
      logger.error(`Server-side: Failed to execute MCP tool ${toolName} on server ${serverId}:`, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}
