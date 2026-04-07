import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { getCustomToolByIdOrTitle } from '@/lib/workflows/custom-tools/operations'
import { isCustomTool } from '@/executor/constants'
import type { CustomToolDefinition } from '@/hooks/queries/custom-tools'
import { extractErrorMessage } from '@/tools/error-extractors'
import { tools } from '@/tools/registry'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { RequestParams } from '@/tools/utils'
import { createCustomToolRequestBody, createParamSchema, createToolConfig } from '@/tools/utils'

const logger = createLogger('ToolsUtils')

export interface GetToolAsyncContext {
  workflowId?: string
  userId?: string
  workspaceId?: string
}

/**
 * Execute the actual request and transform the response.
 * Server-only: uses DNS validation and IP-pinned fetch.
 */
export async function executeRequest(
  toolId: string,
  tool: ToolConfig,
  requestParams: RequestParams
): Promise<ToolResponse> {
  try {
    const { url, method, headers, body } = requestParams
    const isExternalUrl = url.startsWith('http://') || url.startsWith('https://')
    const externalResponse = isExternalUrl
      ? (() => {
          return validateUrlWithDNS(url, 'url').then((urlValidation) => {
            if (!urlValidation.isValid) {
              throw new Error(urlValidation.error)
            }
            return secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, {
              method,
              headers,
              body,
            })
          })
        })()
      : fetch(url, { method, headers, body })

    const resolvedResponse = await externalResponse

    if (!resolvedResponse.ok) {
      let errorData: any
      try {
        errorData = await resolvedResponse.json()
      } catch (_e) {
        try {
          errorData = await resolvedResponse.text()
        } catch (_e2) {
          errorData = null
        }
      }

      const error = extractErrorMessage({
        status: resolvedResponse.status,
        statusText: resolvedResponse.statusText,
        data: errorData,
      })
      logger.error(`${toolId} error:`, { error })
      throw new Error(error)
    }

    const transformResponse =
      tool.transformResponse ||
      (async (resp: Response) => ({
        success: true,
        output: await resp.json(),
      }))

    return await transformResponse(resolvedResponse as Response)
  } catch (error: any) {
    return {
      success: false,
      output: {},
      error: error.message || 'Unknown error',
    }
  }
}

// Get a tool by its ID asynchronously (supports server-side)
export async function getToolAsync(
  toolId: string,
  context: GetToolAsyncContext = {}
): Promise<ToolConfig | undefined> {
  const builtInTool = tools[toolId]
  if (builtInTool) return builtInTool

  if (isCustomTool(toolId)) {
    return fetchCustomToolFromDB(toolId, context)
  }

  return undefined
}

async function fetchCustomToolFromDB(
  customToolId: string,
  context: GetToolAsyncContext
): Promise<ToolConfig | undefined> {
  const { workflowId, userId, workspaceId } = context
  const identifier = customToolId.replace('custom_', '')

  if (!userId) {
    throw new Error(`Cannot fetch custom tool without userId: ${identifier}`)
  }
  if (!workspaceId) {
    throw new Error(`Cannot fetch custom tool without workspaceId: ${identifier}`)
  }

  try {
    const customTool = await getCustomToolByIdOrTitle({
      identifier,
      userId,
      workspaceId,
    })

    if (!customTool) {
      logger.error(`Custom tool not found: ${identifier}`)
      return undefined
    }

    const toolConfig = createToolConfig(customTool as unknown as CustomToolDefinition, customToolId)

    return {
      ...toolConfig,
      params: createParamSchema(customTool),
      request: {
        ...toolConfig.request,
        body: createCustomToolRequestBody(customTool, false, workflowId),
      },
    }
  } catch (error) {
    logger.error(`Error fetching custom tool ${identifier} from DB:`, error)
    return undefined
  }
}
