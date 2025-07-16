import { createLogger } from '@/lib/logs/console-logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { getTool } from '@/tools/utils'

const logger = createLogger('ApiBlockHandler')

/**
 * Handler for API blocks that make external HTTP requests.
 */
export class ApiBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.API
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    // Early return with empty success response if URL is not provided or empty
    if (tool.name?.includes('HTTP') && (!inputs.url || inputs.url.trim() === '')) {
      return { data: null, status: 200, headers: {} }
    }

    // Pre-validate common HTTP request issues to provide better error messages
    if (tool.name?.includes('HTTP') && inputs.url) {
      // Strip any surrounding quotes that might have been added during resolution
      let urlToValidate = inputs.url
      if (typeof urlToValidate === 'string') {
        if (
          (urlToValidate.startsWith('"') && urlToValidate.endsWith('"')) ||
          (urlToValidate.startsWith("'") && urlToValidate.endsWith("'"))
        ) {
          urlToValidate = urlToValidate.slice(1, -1)
          // Update the input with unquoted URL
          inputs.url = urlToValidate
        }
      }

      // Check for missing protocol
      if (!urlToValidate.match(/^https?:\/\//i)) {
        throw new Error(
          `Invalid URL: "${urlToValidate}" - URL must include protocol (try "https://${urlToValidate}")`
        )
      }

      // Detect other common URL issues
      try {
        new URL(urlToValidate)
      } catch (e: any) {
        throw new Error(`Invalid URL format: "${urlToValidate}" - ${e.message}`)
      }
    }

    try {
      const processedInputs = { ...inputs }

      // Handle body specifically to ensure it's properly processed for API requests
      if (processedInputs.body !== undefined) {
        // If body is a string that looks like JSON, parse it
        if (typeof processedInputs.body === 'string') {
          try {
            // Trim whitespace before checking for JSON pattern
            const trimmedBody = processedInputs.body.trim()
            if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
              processedInputs.body = JSON.parse(trimmedBody)
              logger.info(
                '[ApiBlockHandler] Parsed JSON body:',
                JSON.stringify(processedInputs.body, null, 2)
              )
            }
          } catch (e) {
            logger.info('[ApiBlockHandler] Failed to parse body as JSON, using as string:', e)
            // Keep as string if parsing fails
          }
        } else if (processedInputs.body === null) {
          // Convert null to undefined for consistency with API expectations
          processedInputs.body = undefined
        }
      }

      // Ensure the final processed body is logged
      logger.info(
        '[ApiBlockHandler] Final processed request body:',
        JSON.stringify(processedInputs.body, null, 2)
      )

      const result = await executeTool(block.config.tool, {
        ...processedInputs,
        _context: { workflowId: context.workflowId },
      })

      if (!result.success) {
        const errorDetails = []

        // Add request details to error message
        if (inputs.url) errorDetails.push(`URL: ${inputs.url}`)
        if (inputs.method) errorDetails.push(`Method: ${inputs.method}`)

        // Add response details
        if (result.error) errorDetails.push(`Error: ${result.error}`)
        if (result.output?.status) errorDetails.push(`Status: ${result.output.status}`)
        if (result.output?.statusText) errorDetails.push(`Status text: ${result.output.statusText}`)

        // Add specific suggestions for common error codes
        let suggestion = ''
        if (result.output?.status === 403) {
          suggestion = ' - This may be due to CORS restrictions or authorization issues'
        } else if (result.output?.status === 404) {
          suggestion = ' - The requested resource was not found'
        } else if (result.output?.status === 429) {
          suggestion = ' - Too many requests, you may need to implement rate limiting'
        } else if (result.output?.status >= 500) {
          suggestion = ' - Server error, the target server is experiencing issues'
        } else if (result.error?.includes('CORS')) {
          suggestion =
            ' - CORS policy prevented the request, try using a proxy or server-side request'
        } else if (result.error?.includes('Failed to fetch')) {
          suggestion =
            ' - Network error, check if the URL is accessible and if you have internet connectivity'
        }

        const errorMessage =
          errorDetails.length > 0
            ? `HTTP Request failed: ${errorDetails.join(' | ')}${suggestion}`
            : `API request to ${tool.name || block.config.tool} failed with no error message`

        // Create a detailed error object with formatted message
        const error = new Error(errorMessage)

        // Add additional properties for debugging
        Object.assign(error, {
          toolId: block.config.tool,
          toolName: tool.name || 'Unknown tool',
          blockId: block.id,
          blockName: block.metadata?.name || 'Unnamed Block',
          output: result.output || {},
          status: result.output?.status || null,
          request: {
            url: inputs.url,
            method: inputs.method || 'GET',
          },
          timestamp: new Date().toISOString(),
        })

        throw error
      }

      return result.output
    } catch (error: any) {
      // Ensure we have a meaningful error message
      if (!error.message || error.message === 'undefined (undefined)') {
        // Construct a detailed error message with available information
        let errorMessage = `API request to ${tool.name || block.config.tool} failed`

        // Add details if available
        if (inputs.url) errorMessage += `: ${inputs.url}`
        if (error.status) errorMessage += ` (Status: ${error.status})`
        if (error.statusText) errorMessage += ` - ${error.statusText}`

        // If we still have no details, give a generic but helpful message
        if (errorMessage === `API request to ${tool.name || block.config.tool} failed`) {
          errorMessage += ` - ${block.metadata?.name || 'Unknown error'}`
        }

        error.message = errorMessage
      }

      // Add additional context to the error
      if (typeof error === 'object' && error !== null) {
        if (!error.toolId) error.toolId = block.config.tool
        if (!error.blockName) error.blockName = block.metadata?.name || 'Unnamed Block'

        // Add request details if missing
        if (inputs && !error.request) {
          error.request = {
            url: inputs.url,
            method: inputs.method || 'GET',
          }
        }
      }

      throw error
    }
  }
}
