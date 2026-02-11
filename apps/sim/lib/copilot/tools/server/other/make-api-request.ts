import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { executeTool } from '@/tools'
import type { TableRow } from '@/tools/types'

const RESULT_CHAR_CAP = Number(process.env.COPILOT_TOOL_RESULT_CHAR_CAP || 20000)

interface MakeApiRequestParams {
  url: string
  method: 'GET' | 'POST' | 'PUT'
  queryParams?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  body?: unknown
}

interface ApiResponse {
  data: string
  status: number
  headers: Record<string, string>
  truncated?: boolean
  totalChars?: number
  previewChars?: number
  note?: string
}

export const makeApiRequestServerTool: BaseServerTool<MakeApiRequestParams, ApiResponse> = {
  name: 'make_api_request',
  async execute(params: MakeApiRequestParams): Promise<ApiResponse> {
    const logger = createLogger('MakeApiRequestServerTool')
    const { url, method, queryParams, headers, body } = params
    if (!url || !method) throw new Error('url and method are required')

    const toTableRows = (obj?: Record<string, unknown>): TableRow[] | null => {
      if (!obj || typeof obj !== 'object') return null
      return Object.entries(obj).map(([key, value]) => ({
        id: key,
        cells: { Key: key, Value: value },
      }))
    }
    const headersTable = toTableRows(headers)
    const queryParamsTable = toTableRows(queryParams as Record<string, unknown> | undefined)

    const result = await executeTool(
      'http_request',
      { url, method, params: queryParamsTable, headers: headersTable, body },
      true
    )
    if (!result.success) throw new Error(result.error ?? 'API request failed')

    const output = result.output as Record<string, unknown> | undefined
    const nestedOutput = output?.output as Record<string, unknown> | undefined
    const data = nestedOutput?.data ?? output?.data
    const status = (nestedOutput?.status ?? output?.status ?? 200) as number
    const respHeaders = (nestedOutput?.headers ?? output?.headers ?? {}) as Record<string, string>

    const toStringSafe = (val: unknown): string => {
      if (typeof val === 'string') return val
      try {
        return JSON.stringify(val)
      } catch {
        return String(val)
      }
    }

    const stripHtml = (html: string): string => {
      try {
        let text = html
        let previous: string
        do {
          previous = text
          text = text.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
          text = text.replace(/<style[\s\S]*?<\/style\s*>/gi, '')
          text = text.replace(/<[^>]*>/g, ' ')
          text = text.replace(/[<>]/g, ' ')
        } while (text !== previous)
        return text.replace(/\s+/g, ' ').trim()
      } catch {
        return html
      }
    }

    let normalized = toStringSafe(data)
    const looksLikeHtml =
      /<html[\s\S]*<\/html>/i.test(normalized) || /<body[\s\S]*<\/body>/i.test(normalized)
    if (looksLikeHtml) normalized = stripHtml(normalized)

    const totalChars = normalized.length
    if (totalChars > RESULT_CHAR_CAP) {
      const preview = normalized.slice(0, RESULT_CHAR_CAP)
      logger.warn('API response truncated', { url, method, totalChars, cap: RESULT_CHAR_CAP })
      return {
        data: preview,
        status,
        headers: respHeaders,
        truncated: true,
        totalChars,
        previewChars: preview.length,
        note: `Response truncated to ${RESULT_CHAR_CAP} characters`,
      }
    }

    logger.debug('API request executed', { url, method, status, totalChars })
    return { data: normalized, status, headers: respHeaders }
  },
}
