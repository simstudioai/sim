import { createLogger } from '@sim/logger'
import type { TinybirdQueryPipeParams, TinybirdQueryPipeResponse } from '@/tools/tinybird/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tinybird-query-pipe')

/**
 * Parses the dynamic-parameters input, which may arrive as a JSON object or a
 * JSON string from a code/json subBlock. An omitted or empty value means "no
 * parameters"; a non-empty value that is not a valid JSON object throws, so a
 * mistyped input fails loudly instead of silently dropping the filters.
 */
function parsePipeParameters(
  input: TinybirdQueryPipeParams['parameters']
): Record<string, unknown> {
  if (input === undefined || input === null) return {}
  if (typeof input === 'object') return input as Record<string, unknown>

  const trimmed = input.trim()
  if (!trimmed) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(
      'Invalid Pipe parameters: expected a JSON object of key/value pairs (e.g. {"limit": 10})'
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid Pipe parameters: expected a JSON object, not a primitive or array')
  }
  return parsed as Record<string, unknown>
}

/**
 * Tinybird Query Pipe Tool
 *
 * Calls a published Tinybird Pipe API Endpoint by name using the `.json` format,
 * which is an alias for `SELECT * FROM {pipe}`. Templated Pipe parameters are passed
 * as query-string arguments, and an optional `q` lets you run SQL on top of the result
 * (using `_` to reference the Pipe).
 */
export const queryPipeTool: ToolConfig<TinybirdQueryPipeParams, TinybirdQueryPipeResponse> = {
  id: 'tinybird_query_pipe',
  name: 'Tinybird Query Pipe',
  description:
    'Call a published Tinybird Pipe API Endpoint by name, passing dynamic parameters and receiving structured JSON results.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',

  params: {
    base_url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API base URL (e.g., https://api.tinybird.co)',
    },
    pipe: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the published Pipe API Endpoint to call. Example: "top_pages"',
    },
    parameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Dynamic Pipe parameters as a JSON object, sent as query-string arguments. Example: {"start_date": "2024-01-01", "limit": 10}',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional SQL to run on top of the Pipe result. Use "_" to reference the Pipe. Example: "SELECT count() FROM _"',
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
      const baseUrl = params.base_url.trim().replace(/\/+$/, '')
      const url = new URL(`${baseUrl}/v0/pipes/${encodeURIComponent(params.pipe.trim())}.json`)
      if (params.q) {
        url.searchParams.set('q', params.q)
      }
      const dynamic = parsePipeParameters(params.parameters)
      for (const [key, value] of Object.entries(dynamic)) {
        // Don't let a dynamic parameter clobber the reserved `q` set above
        if (key === 'q') continue
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.token.trim()}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    logger.info('Successfully called Tinybird Pipe endpoint', {
      rows: data.rows,
      elapsed: data.statistics?.elapsed,
    })

    return {
      success: true,
      output: {
        data: data.data ?? [],
        meta: data.meta ?? undefined,
        rows: data.rows ?? undefined,
        rows_before_limit_at_least: data.rows_before_limit_at_least ?? undefined,
        statistics: data.statistics
          ? {
              elapsed: data.statistics.elapsed,
              rows_read: data.statistics.rows_read,
              bytes_read: data.statistics.bytes_read,
            }
          : undefined,
      },
    }
  },

  outputs: {
    data: {
      type: 'json',
      description: 'Pipe result data as an array of row objects',
    },
    meta: {
      type: 'array',
      description: 'Column metadata for the result set',
      optional: true,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Column name' },
          type: { type: 'string', description: 'Column data type' },
        },
      },
    },
    rows: {
      type: 'number',
      description: 'Number of rows returned',
      optional: true,
    },
    rows_before_limit_at_least: {
      type: 'number',
      description: 'Minimum number of rows there would be without a LIMIT clause',
      optional: true,
    },
    statistics: {
      type: 'json',
      description: 'Query execution statistics - elapsed time, rows read, bytes read',
      optional: true,
      properties: {
        elapsed: { type: 'number', description: 'Query execution time in seconds' },
        rows_read: { type: 'number', description: 'Number of rows processed' },
        bytes_read: { type: 'number', description: 'Number of bytes processed' },
      },
    },
  },
}
