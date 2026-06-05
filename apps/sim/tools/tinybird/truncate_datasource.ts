import { createLogger } from '@sim/logger'
import type {
  TinybirdTruncateDatasourceParams,
  TinybirdTruncateDatasourceResponse,
} from '@/tools/tinybird/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tinybird-truncate-datasource')

/**
 * Tinybird Truncate Data Source Tool
 *
 * Deletes all rows from a Data Source. Dependent Materialized Views are not
 * truncated in cascade. The endpoint returns a minimal (often empty) body on success.
 */
export const truncateDatasourceTool: ToolConfig<
  TinybirdTruncateDatasourceParams,
  TinybirdTruncateDatasourceResponse
> = {
  id: 'tinybird_truncate_datasource',
  name: 'Tinybird Truncate Data Source',
  description: 'Delete all rows from a Tinybird Data Source.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',

  params: {
    base_url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API base URL (e.g., https://api.tinybird.co)',
    },
    datasource: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Data Source to truncate. Example: "events_raw"',
    },
    token: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API Token with DATASOURCES:CREATE scope',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.base_url.trim().replace(/\/+$/, '')
      return `${baseUrl}/v0/datasources/${encodeURIComponent(params.datasource.trim())}/truncate`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.token.trim()}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const text = await response.text()
    let result: Record<string, unknown> | null = null
    if (text) {
      try {
        result = JSON.parse(text)
      } catch {
        result = null
      }
    }

    logger.info('Successfully truncated Tinybird Data Source')

    return {
      success: true,
      output: {
        truncated: true,
        result,
      },
    }
  },

  outputs: {
    truncated: {
      type: 'boolean',
      description: 'Whether the Data Source was truncated successfully',
    },
    result: {
      type: 'json',
      description: 'Raw response body from the truncate endpoint, if any',
      optional: true,
    },
  },
}
