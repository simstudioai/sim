import type {
  CrowdStrikeDeleteIndicatorsParams,
  CrowdStrikeDeleteIndicatorsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeDeleteIndicatorsTool: ToolConfig<
  CrowdStrikeDeleteIndicatorsParams,
  CrowdStrikeDeleteIndicatorsResponse
> = {
  id: 'crowdstrike_delete_indicators',
  name: 'CrowdStrike Delete Indicators',
  description:
    'Permanently delete custom CrowdStrike Falcon indicators of compromise (DELETE /iocs/entities/indicators/v1). This cannot be undone, and deleting a blocking indicator removes that protection from every host. If a filter is supplied it takes precedence and the ID list is ignored, so a broad filter can delete far more than intended. Requires the "IOC Management: Write" API scope.',
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
    indicatorIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of CrowdStrike IOC IDs to delete. Ignored when a filter is also supplied.',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Falcon Query Language filter selecting indicators to delete in bulk. Takes precedence over the ID list.',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Audit comment explaining why these indicators were deleted',
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
      comment: params.comment,
      filter: params.filter,
      indicatorIds: params.indicatorIds,
      operation: 'crowdstrike_delete_indicators',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to delete CrowdStrike indicators')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    deletedIds: {
      type: 'array',
      description: 'IOC IDs CrowdStrike deleted',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      description: 'Number of indicators deleted',
    },
    errors: {
      type: 'array',
      description: 'Errors CrowdStrike returned alongside a partially successful response',
      optional: true,
      items: {
        type: 'object',
        properties: {
          code: { type: 'number', description: 'CrowdStrike error code', optional: true },
          id: { type: 'string', description: 'Identifier the error applies to', optional: true },
          message: { type: 'string', description: 'Error message', optional: true },
        },
      },
    },
  },
}
