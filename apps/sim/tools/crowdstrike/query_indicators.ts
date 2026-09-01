import type {
  CrowdStrikeQueryIndicatorsParams,
  CrowdStrikeQueryIndicatorsResponse,
} from '@/tools/crowdstrike/types'
import type { InternalToolConfig } from '@/tools/types'

export const crowdstrikeQueryIndicatorsTool: InternalToolConfig<
  CrowdStrikeQueryIndicatorsParams,
  CrowdStrikeQueryIndicatorsResponse
> = {
  id: 'crowdstrike_query_indicators',
  name: 'CrowdStrike Query Indicators',
  description:
    'Search custom CrowdStrike Falcon indicators of compromise (IOCs) with a Falcon Query Language filter and return their IDs (GET /iocs/queries/indicators/v1). Requires the "IOC Management: Read" API scope.',
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
      description: 'Falcon Query Language filter over IOC fields',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum number of IOC IDs to return (default 100). CrowdStrike publishes no maximum for this endpoint; Sim caps it at 500 to keep a single request bounded',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination offset. Mutually exclusive with the after cursor; use after beyond 10,000 IOCs.',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response. Mutually exclusive with offset.',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort expression. Supported fields include action, applied_globally, created_by, created_on, expiration, expired, modified_by, modified_on, severity_number, source, type, and value.',
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
      offset: params.offset,
      operation: 'crowdstrike_query_indicators',
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike indicators')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    indicatorIds: {
      type: 'array',
      description: 'IOC IDs matching the query',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      description: 'Number of IOC IDs returned',
    },
    pagination: {
      type: 'json',
      description: 'Pagination metadata (limit, offset, total, after)',
      optional: true,
      properties: {
        limit: { type: 'number', description: 'Page size used for the query', optional: true },
        offset: { type: 'number', description: 'Offset returned by CrowdStrike', optional: true },
        total: { type: 'number', description: 'Total records available', optional: true },
        after: { type: 'string', description: 'Cursor for the next page', optional: true },
      },
    },
  },
}
