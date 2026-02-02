import { createLogger } from '@sim/logger'
import type { TinybirdQueryParams, TinybirdQueryResponse } from '@/tools/tinybird/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tinybird-query')

/**
 * Tinybird Query Tool
 *
 * Executes SQL queries against Tinybird and returns results in the format specified in the query.
 * - FORMAT JSON: Returns structured data with rows/statistics metadata
 * - FORMAT CSV/TSV/etc: Returns raw text string
 *
 * The tool automatically detects the response format based on Content-Type headers.
 */
export const queryTool: ToolConfig<TinybirdQueryParams, TinybirdQueryResponse> = {
  id: 'tinybird_query',
  name: 'Tinybird Query',
  description: 'Execute SQL queries against Tinybird Pipes and Data Sources using the Query API.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',

  params: {
    base_url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API base URL (e.g., https://api.tinybird.co)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SQL query to execute. Specify your desired output format (e.g., FORMAT JSON, FORMAT CSV, FORMAT TSV). JSON format provides structured data, while other formats return raw text. Example: "SELECT * FROM my_datasource LIMIT 100 FORMAT JSON"',
    },
    pipeline: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional pipe name. When provided, enables SELECT * FROM _ syntax. Example: "my_pipe", "analytics_pipe"',
    },
    token: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API Token with PIPE:READ scope',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.base_url.endsWith('/') ? params.base_url.slice(0, -1) : params.base_url
      return `${baseUrl}/v0/sql`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${params.token}`,
    }),
    body: (params) => {
      const searchParams = new URLSearchParams()
      searchParams.set('q', params.query)
      if (params.pipeline) {
        searchParams.set('pipeline', params.pipeline)
      }
      return searchParams.toString()
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const contentType = response.headers.get('content-type') || ''

    // Check if response is JSON based on content-type or try parsing
    const isJson = contentType.includes('application/json') || contentType.includes('text/json')

    if (isJson) {
      try {
        const data = JSON.parse(responseText)
        logger.info('Successfully executed Tinybird query (JSON)', {
          rows: data.rows,
          elapsed: data.statistics?.elapsed,
        })

        return {
          success: true,
          output: {
            data: data.data || [],
            rows: data.rows || 0,
            statistics: data.statistics
              ? {
                  elapsed: data.statistics.elapsed,
                  rows_read: data.statistics.rows_read,
                  bytes_read: data.statistics.bytes_read,
                }
              : undefined,
          },
        }
      } catch (parseError) {
        logger.error('Failed to parse JSON response', {
          contentType,
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
        })
        throw new Error(
          `Invalid JSON response: ${parseError instanceof Error ? parseError.message : 'Parse error'}`
        )
      }
    }

    // For non-JSON formats (CSV, TSV, etc.), return as raw text
    logger.info('Successfully executed Tinybird query (non-JSON)', { contentType })
    return {
      success: true,
      output: {
        data: responseText,
        rows: undefined,
        statistics: undefined,
      },
    }
  },

  outputs: {
    data: {
      type: 'json',
      description:
        'Query result data. For FORMAT JSON: array of objects. For other formats (CSV, TSV, etc.): raw text string.',
    },
    rows: {
      type: 'number',
      description: 'Number of rows returned (only available with FORMAT JSON)',
    },
    statistics: {
      type: 'json',
      description:
        'Query execution statistics - elapsed time, rows read, bytes read (only available with FORMAT JSON)',
    },
  },
}
