import type {
  DatadogV2Resource,
  ListSecuritySignalsParams,
  ListSecuritySignalsResponse,
  SecuritySignalAttributes,
} from '@/tools/datadog/types'
import { datadogApiUrl, datadogErrorMessage, datadogHeaders } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const listSecuritySignalsTool: ToolConfig<
  ListSecuritySignalsParams,
  ListSecuritySignalsResponse
> = {
  id: 'datadog_list_security_signals',
  name: 'Datadog List Security Signals',
  description:
    'Search Cloud SIEM security signals by query and time range. Requires the `security_monitoring_signals_read` permission.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Signal search query (e.g., "security:attack status:high")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Minimum timestamp as an ISO-8601 date-time (e.g., "2026-01-02T09:42:36.320Z"). Signal search does not accept relative expressions like "now-1h".',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum timestamp as an ISO-8601 date-time (e.g., "2026-01-03T09:42:36.320Z"). Signal search does not accept relative expressions like "now".',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "timestamp" for oldest first, "-timestamp" for newest first',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned as nextCursor by a previous call',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of signals to return (default: 10, max: 1000)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => datadogApiUrl(params.site, '/api/v2/security_monitoring/signals/search'),
    method: 'POST',
    headers: datadogHeaders,
    body: (params) => {
      const filter: Record<string, string> = {}
      if (params.query) filter.query = params.query
      if (params.from) filter.from = params.from
      if (params.to) filter.to = params.to

      const page: Record<string, string | number> = {}
      if (params.cursor) page.cursor = params.cursor
      if (params.limit !== undefined) page.limit = params.limit

      const body: Record<string, unknown> = {}
      if (Object.keys(filter).length > 0) body.filter = filter
      if (Object.keys(page).length > 0) body.page = page
      if (params.sort) body.sort = params.sort

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { signals: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        signals: (data.data ?? []).map((signal: DatadogV2Resource<SecuritySignalAttributes>) => ({
          id: signal.id,
          type: signal.type,
          attributes: signal.attributes ?? {},
        })),
        nextCursor: data.meta?.page?.after,
      },
    }
  },

  outputs: {
    signals: {
      type: 'array',
      description: 'List of security signals',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Signal ID' },
          type: { type: 'string', description: 'Resource type (signal)' },
          attributes: {
            type: 'object',
            description: 'Signal attributes',
            properties: {
              message: { type: 'string', description: 'Message from the detection rule' },
              timestamp: { type: 'string', description: 'Signal timestamp' },
              tags: { type: 'array', description: 'Tags on the signal' },
              custom: { type: 'object', description: 'Signal-specific attributes' },
            },
          },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page of signals',
      optional: true,
    },
  },
}
