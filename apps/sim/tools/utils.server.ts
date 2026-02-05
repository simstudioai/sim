import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { extractErrorMessage } from '@/tools/error-extractors'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { RequestParams } from '@/tools/utils'

const logger = createLogger('ToolsUtils')

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
