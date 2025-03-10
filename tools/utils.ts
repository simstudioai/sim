import { TableRow } from './types'
import { ToolConfig, ToolResponse } from './types'

/**
 * Transforms a table from the store format to a key-value object
 * @param table Array of table rows from the store
 * @returns Record of key-value pairs
 */
export const transformTable = (table: TableRow[] | null): Record<string, string> => {
  if (!table) return {}

  return table.reduce(
    (acc, row) => {
      if (row.cells?.Key && row.cells?.Value !== undefined) {
        acc[row.cells.Key] = row.cells.Value
      }
      return acc
    },
    {} as Record<string, string>
  )
}

interface RequestParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/**
 * Format request parameters based on tool configuration and provided params
 */
export function formatRequestParams(tool: ToolConfig, params: Record<string, any>): RequestParams {
  // Process URL
  const url = typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

  // Process method
  const method = params.method || tool.request.method || 'GET'

  // Process headers
  const headers = tool.request.headers ? tool.request.headers(params) : {}

  // Process body
  const hasBody = method !== 'GET' && method !== 'HEAD' && !!tool.request.body
  const bodyResult = tool.request.body ? tool.request.body(params) : undefined

  // Special handling for NDJSON content type
  const isNDJSON = headers['Content-Type'] === 'application/x-ndjson'
  const body = hasBody
    ? isNDJSON && bodyResult
      ? bodyResult.body
      : JSON.stringify(bodyResult)
    : undefined

  return { url, method, headers, body }
}

/**
 * Execute the actual request and transform the response
 */
export async function executeRequest(
  toolId: string,
  tool: ToolConfig,
  requestParams: RequestParams
): Promise<ToolResponse> {
  try {
    const { url, method, headers, body } = requestParams

    const externalResponse = await fetch(url, { method, headers, body })

    if (!externalResponse.ok) {
      let errorContent
      try {
        errorContent = await externalResponse.json()
      } catch (e) {
        errorContent = { message: externalResponse.statusText }
      }

      // Use the tool's error transformer or a default message
      if (tool.transformError) {
        try {
          const errorResult = tool.transformError(errorContent)

          // Handle both string and Promise return types
          if (typeof errorResult === 'string') {
            throw new Error(errorResult)
          } else {
            // It's a Promise, await it
            const transformedError = await errorResult
            // If it's a string or has an error property, use it
            if (typeof transformedError === 'string') {
              throw new Error(transformedError)
            } else if (
              transformedError &&
              typeof transformedError === 'object' &&
              'error' in transformedError
            ) {
              throw new Error(transformedError.error || 'Tool returned an error')
            }
            // Fallback
            throw new Error('Tool returned an error')
          }
        } catch (e) {
          if (e instanceof Error) {
            throw e
          }
          throw new Error(`${toolId} API error: ${externalResponse.statusText}`)
        }
      } else {
        const error = errorContent.message || `${toolId} API error: ${externalResponse.statusText}`
        console.error(`${toolId} error:`, error)
        throw new Error(error)
      }
    }

    const transformResponse =
      tool.transformResponse ||
      (async (resp: Response) => ({
        success: true,
        output: await resp.json(),
      }))

    return await transformResponse(externalResponse)
  } catch (error: any) {
    return {
      success: false,
      output: {},
      error: error.message || 'Unknown error',
    }
  }
}

/**
 * Validates the tool and its parameters
 */
export function validateToolRequest(
  toolId: string,
  tool: ToolConfig | undefined,
  params: Record<string, any>
): void {
  if (!tool) {
    throw new Error(`Tool not found: ${toolId}`)
  }

  // Ensure all required parameters for tool call are provided
  for (const [paramName, paramConfig] of Object.entries(tool.params)) {
    if (paramConfig.requiredForToolCall && !(paramName in params)) {
      throw new Error(`Parameter "${paramName}" is required for ${toolId} but was not provided`)
    }
  }
}
