import {
  INCIDENTIO_ALERT_OUTPUT_PROPERTIES,
  type IncidentioAlertsListParams,
  type IncidentioAlertsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

/** incident.io requires a page size on this endpoint, so fall back to its documented default. */
const DEFAULT_PAGE_SIZE = 25

export const alertsListTool: ToolConfig<IncidentioAlertsListParams, IncidentioAlertsListResponse> =
  {
    id: 'incidentio_alerts_list',
    name: 'List Alerts',
    description:
      'List alerts in incident.io, optionally filtered by status, source, or created date',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'incident.io API Key',
      },
      page_size: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results per page (e.g., 10, 25, 50). Default: 25',
      },
      after: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Pagination cursor to fetch the next page of results (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
      },
      status: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by alert status: "firing" or "resolved"',
      },
      status_operator: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'How to apply the status filter: "one_of" to match it, "not_in" to exclude it. Default: one_of',
      },
      alert_source_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by alert source ID (e.g., "01GBSQF3FHF7FWZQNWGHAVQ804")',
      },
      alert_source_operator: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'How to apply the alert source filter: "one_of" to match it, "not_in" to exclude it. Default: one_of',
      },
      deduplication_key: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to the single alert with this deduplication key',
      },
      created_at_gte: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only return alerts created on or after this date (e.g., "2025-01-01")',
      },
      created_at_lte: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only return alerts created on or before this date (e.g., "2025-02-01")',
      },
      has_notes: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter to alerts that do (true) or do not (false) have notes attached',
      },
      include_maintenance_window: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Whether to include alerts held by a maintenance window. Defaults to true on the API',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://api.incident.io/v2/alerts')
        url.searchParams.set(
          'page_size',
          String(params.page_size && params.page_size > 0 ? params.page_size : DEFAULT_PAGE_SIZE)
        )

        if (params.after) {
          url.searchParams.set('after', params.after)
        }
        if (params.status) {
          url.searchParams.set(
            `status[${params.status_operator ?? 'one_of'}]`,
            params.status.trim()
          )
        }
        if (params.alert_source_id) {
          url.searchParams.set(
            `alert_source[${params.alert_source_operator ?? 'one_of'}]`,
            params.alert_source_id.trim()
          )
        }
        if (params.deduplication_key) {
          url.searchParams.set('deduplication_key[is]', params.deduplication_key.trim())
        }
        if (params.created_at_gte) {
          url.searchParams.set('created_at[gte]', params.created_at_gte.trim())
        }
        if (params.created_at_lte) {
          url.searchParams.set('created_at[lte]', params.created_at_lte.trim())
        }
        if (typeof params.has_notes === 'boolean') {
          url.searchParams.set('has_notes[is]', String(params.has_notes))
        }
        if (typeof params.include_maintenance_window === 'boolean') {
          url.searchParams.set(
            'include_maintenance_window[is]',
            String(params.include_maintenance_window)
          )
        }

        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          alerts: data.alerts ?? [],
          pagination_meta: data.pagination_meta,
        },
      }
    },

    outputs: {
      alerts: {
        type: 'array',
        description: 'List of alerts',
        items: {
          type: 'object',
          properties: INCIDENTIO_ALERT_OUTPUT_PROPERTIES,
        },
      },
      pagination_meta: {
        type: 'object',
        description: 'Pagination metadata',
        optional: true,
        properties: {
          after: { type: 'string', description: 'Cursor for next page', optional: true },
          page_size: { type: 'number', description: 'Number of results per page' },
        },
      },
    },
  }
