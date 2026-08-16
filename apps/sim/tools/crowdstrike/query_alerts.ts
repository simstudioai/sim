import type {
  CrowdStrikeQueryAlertsParams,
  CrowdStrikeQueryAlertsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeQueryAlertsTool: ToolConfig<
  CrowdStrikeQueryAlertsParams,
  CrowdStrikeQueryAlertsResponse
> = {
  id: 'crowdstrike_query_alerts',
  name: 'CrowdStrike Query Alerts',
  description:
    'Search CrowdStrike Falcon alerts with a Falcon Query Language filter and return their composite IDs. Uses the current Alerts API (GET /alerts/queries/alerts/v2), which replaced the Detects API decommissioned on September 30, 2025. Requires the "Alerts: Read" API scope.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client secret',
    },
    cloud: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon cloud region',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Falcon Query Language filter over alert fields',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across all alert metadata',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of alert IDs to return (max 10000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset for the alert query',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression such as "created_timestamp|desc"',
    },
    includeHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include previously hidden alerts (CrowdStrike defaults this to true)',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      filter: params.filter,
      includeHidden: params.includeHidden,
      limit: params.limit,
      offset: params.offset,
      operation: 'crowdstrike_query_alerts',
      q: params.q,
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike alerts')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    alertIds: {
      type: 'array',
      description: 'Composite alert IDs matching the query, ready for Get Alert Details',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      description: 'Number of alert IDs returned',
    },
    pagination: {
      type: 'json',
      description: 'Pagination metadata (limit, offset, total)',
      optional: true,
      properties: {
        limit: { type: 'number', description: 'Page size used for the query', optional: true },
        offset: { type: 'number', description: 'Offset returned by CrowdStrike', optional: true },
        total: { type: 'number', description: 'Total records available', optional: true },
      },
    },
  },
}
