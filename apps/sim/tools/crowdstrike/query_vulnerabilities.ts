import type {
  CrowdStrikeQueryVulnerabilitiesParams,
  CrowdStrikeQueryVulnerabilitiesResponse,
} from '@/tools/crowdstrike/types'
import type { InternalToolConfig } from '@/tools/types'

export const crowdstrikeQueryVulnerabilitiesTool: InternalToolConfig<
  CrowdStrikeQueryVulnerabilitiesParams,
  CrowdStrikeQueryVulnerabilitiesResponse
> = {
  id: 'crowdstrike_query_vulnerabilities',
  name: 'CrowdStrike Query Vulnerabilities',
  description:
    'Search CrowdStrike Falcon Spotlight vulnerabilities with a required Falcon Query Language filter and return their IDs (GET /spotlight/queries/vulnerabilities/v1). Requires the spotlight-vulnerabilities:read API scope, shown as "Vulnerabilities: Read" in the Falcon API client UI.',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Falcon Query Language filter (required by Spotlight). Filterable fields include status, aid, cid, last_seen_within, cve.id, cve.severity, cve.exprt_rating, cve.is_cisa_kev, cve.base_score, host_info.platform_name, host_info.groups, host_info.tags, host_info.internet_exposure, and suppression_info.is_suppressed.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of vulnerability IDs to return (1-400, default 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response. Spotlight does not support offset.',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression such as "updated_timestamp|desc" or "closed_timestamp|asc"',
    },
  },

  operation: {
    input: (params) => ({
      after: params.after,
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      filter: params.filter,
      limit: params.limit,
      operation: 'crowdstrike_query_vulnerabilities',
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike vulnerabilities')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    vulnerabilityIds: {
      type: 'array',
      description: 'Spotlight vulnerability IDs matching the query',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      description: 'Number of vulnerability IDs returned',
    },
    pagination: {
      type: 'json',
      description: 'Cursor pagination metadata (limit, total, after)',
      optional: true,
      properties: {
        limit: { type: 'number', description: 'Page size used for the query', optional: true },
        total: { type: 'number', description: 'Total records available', optional: true },
        after: { type: 'string', description: 'Cursor for the next page', optional: true },
      },
    },
  },
}
