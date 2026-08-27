import type {
  CrowdStrikeQueryCasesParams,
  CrowdStrikeQueryCasesResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeQueryCasesTool: ToolConfig<
  CrowdStrikeQueryCasesParams,
  CrowdStrikeQueryCasesResponse
> = {
  id: 'crowdstrike_query_cases',
  name: 'CrowdStrike Query Cases',
  description:
    'Search CrowdStrike Falcon Case Management cases with a Falcon Query Language filter and return their IDs (GET /cases/queries/cases/v1). Case Management supersedes the CrowdScore Incidents API, which CrowdStrike has removed from its published API spec. Requires the "Cases: Read" API scope.',
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
      description:
        'Falcon Query Language filter. Exact-match fields include cid and id; wildcard fields include assigned_to_name and assigned_to_uuid; range fields include created_timestamp and updated_timestamp.',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across all case metadata',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of case IDs to return (max 10000, default 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset for the case query',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression such as "created_timestamp|desc" or "status|asc"',
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
      limit: params.limit,
      offset: params.offset,
      operation: 'crowdstrike_query_cases',
      q: params.q,
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike cases')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    caseIds: {
      type: 'array',
      description: 'Case IDs matching the query',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      description: 'Number of case IDs returned',
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
