import { createLogger } from '@/lib/logs/console/logger'
import { executeTool } from '@/tools'
import type { TableRow } from '@/tools/types'
import { BaseCopilotTool } from '../base'

interface MakeApiRequestParams {
  url: string
  method: 'GET' | 'POST' | 'PUT'
  queryParams?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  body?: any
}

interface MakeApiRequestResult {
  data: any
  status: number
  headers: Record<string, any>
  truncated?: boolean
  totalChars?: number
  previewChars?: number
  note?: string
}

class MakeApiRequestTool extends BaseCopilotTool<MakeApiRequestParams, MakeApiRequestResult> {
  readonly id = 'make_api_request'
  readonly displayName = 'Making API request'
  readonly requiresInterrupt = true

  protected async executeImpl(params: MakeApiRequestParams): Promise<MakeApiRequestResult> {
    const logger = createLogger('MakeApiRequestTool')

    const { url, method, queryParams, headers, body } = params

    if (!url || !method) {
      throw new Error('url and method are required')
    }

    const toTableRows = (obj?: Record<string, any>): TableRow[] | null => {
      if (!obj || typeof obj !== 'object') return null
      return Object.entries(obj).map(([key, value]) => ({
        id: key,
        cells: { Key: key, Value: value },
      }))
    }

    const headersTable = toTableRows(headers)
    const queryParamsTable = toTableRows(queryParams as Record<string, any> | undefined)

    const result = await executeTool(
      'http_request',
      {
        url,
        method,
        params: queryParamsTable,
        headers: headersTable,
        body,
      },
      true
    )

    if (!result.success) {
      throw new Error(result.error || 'API request failed')
    }

    const output = (result as any).output || result
    const data = output.output?.data ?? output.data
    const status = output.output?.status ?? output.status ?? 200
    const respHeaders = output.output?.headers ?? output.headers ?? {}

    // Character cap
    const CAP = Number(process.env.COPILOT_TOOL_RESULT_CHAR_CAP || 20000)

    // Content-aware trimming
    const toStringSafe = (val: any): string => {
      if (typeof val === 'string') return val
      try {
        return JSON.stringify(val)
      } catch {
        return String(val)
      }
    }

    const stripHtml = (html: string): string => {
      try {
        // Remove tags and collapse whitespace
        return html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      } catch {
        return html
      }
    }

    // Normalize to string for measurement
    let normalized = toStringSafe(data)

    // If looks like HTML, strip for readability before capping
    const looksLikeHtml =
      /<html[\s\S]*<\/html>/i.test(normalized) || /<body[\s\S]*<\/body>/i.test(normalized)
    if (looksLikeHtml) {
      normalized = stripHtml(normalized)
    }

    const totalChars = normalized.length

    if (totalChars > CAP) {
      const preview = normalized.slice(0, CAP)
      logger.warn('API response truncated by character cap', {
        url,
        method,
        totalChars,
        previewChars: preview.length,
        cap: CAP,
      })
      return {
        data: preview,
        status,
        headers: respHeaders,
        truncated: true,
        totalChars,
        previewChars: preview.length,
        note: `Response truncated to ${CAP} characters to avoid large payloads`,
      }
    }

    logger.info('API request executed', { url, method, status, totalChars })

    return { data: normalized, status, headers: respHeaders }
  }
}

export const makeApiRequestTool = new MakeApiRequestTool()
