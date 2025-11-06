import { createLogger } from '@/lib/logs/console/logger'
import { BlockType, HTTP } from '@/executor/consts'
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
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    if (tool.name?.includes('HTTP') && (!inputs.url || inputs.url.trim() === '')) {
      return { data: null, status: HTTP.STATUS.OK, headers: {} }
    }

    if (tool.name?.includes('HTTP') && inputs.url) {
      let urlToValidate = inputs.url
      if (typeof urlToValidate === 'string') {
        if (
          (urlToValidate.startsWith('"') && urlToValidate.endsWith('"')) ||
          (urlToValidate.startsWith("'") && urlToValidate.endsWith("'"))
        ) {
          urlToValidate = urlToValidate.slice(1, -1)
          inputs.url = urlToValidate
        }
      }

      if (!urlToValidate.match(/^https?:\/\//i)) {
        throw new Error(
          `Invalid URL: "${urlToValidate}" - URL must include protocol (try "https://${urlToValidate}")`
        )
      }

      try {
        new URL(urlToValidate)
      } catch (e: any) {
        throw new Error(`Invalid URL format: "${urlToValidate}" - ${e.message}`)
      }
    }

    try {
      const processedInputs = { ...inputs }

      if (processedInputs.body !== undefined) {
        if (typeof processedInputs.body === 'string') {
          try {
            const trimmedBody = processedInputs.body.trim()
            if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
              processedInputs.body = JSON.parse(trimmedBody)
            }
          } catch (e) {}
        } else if (processedInputs.body === null) {
          processedInputs.body = undefined
        }
      }

      const result = await executeTool(
        block.config.tool,
        {
          ...processedInputs,
          _context: {
            workflowId: ctx.workflowId,
            workspaceId: ctx.workspaceId,
            executionId: ctx.executionId,
          },
        },
        false,
        false,
        ctx
      )

      if (!result.success) {
        const errorDetails = []

        if (inputs.url) errorDetails.push(`URL: ${inputs.url}`)
        if (inputs.method) errorDetails.push(`Method: ${inputs.method}`)

        if (result.error) errorDetails.push(`Error: ${result.error}`)
        if (result.output?.status) errorDetails.push(`Status: ${result.output.status}`)
        if (result.output?.statusText) errorDetails.push(`Status text: ${result.output.statusText}`)

        let suggestion = ''
        if (result.output?.status === HTTP.STATUS.FORBIDDEN) {
          suggestion = ' - This may be due to CORS restrictions or authorization issues'
        } else if (result.output?.status === HTTP.STATUS.NOT_FOUND) {
          suggestion = ' - The requested resource was not found'
        } else if (result.output?.status === HTTP.STATUS.TOO_MANY_REQUESTS) {
          suggestion = ' - Too many requests, you may need to implement rate limiting'
        } else if (result.output?.status >= HTTP.STATUS.SERVER_ERROR) {
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

        const error = new Error(errorMessage)

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
      if (!error.message || error.message === 'undefined (undefined)') {
        let errorMessage = `API request to ${tool.name || block.config.tool} failed`

        if (inputs.url) errorMessage += `: ${inputs.url}`
        if (error.status) errorMessage += ` (Status: ${error.status})`
        if (error.statusText) errorMessage += ` - ${error.statusText}`

        if (errorMessage === `API request to ${tool.name || block.config.tool} failed`) {
          errorMessage += ` - ${block.metadata?.name || 'Unknown error'}`
        }

        error.message = errorMessage
      }

      if (typeof error === 'object' && error !== null) {
        if (!error.toolId) error.toolId = block.config.tool
        if (!error.blockName) error.blockName = block.metadata?.name || 'Unnamed Block'

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
