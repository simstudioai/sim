import type {
  CloudTrailGetInsightSelectorsParams,
  CloudTrailGetInsightSelectorsResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const getInsightSelectorsTool: InternalToolConfig<
  CloudTrailGetInsightSelectorsParams,
  CloudTrailGetInsightSelectorsResponse
> = {
  id: 'cloudtrail_get_insight_selectors',
  name: 'CloudTrail Get Insight Selectors',
  description: 'Read which CloudTrail Insights types are enabled on a trail or event data store',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    trailName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trail name or trail ARN. Cannot be combined with eventDataStore',
    },
    eventDataStore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Event data store ARN, or the ID suffix of that ARN. Cannot be combined with trailName',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.trailName && { trailName: params.trailName }),
      ...(params.eventDataStore && { eventDataStore: params.eventDataStore }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudTrail Insights selectors')
    }
    return {
      success: true,
      output: {
        trailArn: data.output.trailArn ?? null,
        eventDataStoreArn: data.output.eventDataStoreArn ?? null,
        insightsDestination: data.output.insightsDestination ?? null,
        insightSelectors: data.output.insightSelectors ?? [],
      },
    }
  },

  outputs: {
    trailArn: {
      type: 'string',
      description: 'ARN of the trail whose Insights selectors were read',
      optional: true,
    },
    eventDataStoreArn: {
      type: 'string',
      description: 'ARN of the source event data store that enabled Insights events',
      optional: true,
    },
    insightsDestination: {
      type: 'string',
      description: 'ARN of the destination event data store that logs Insights events',
      optional: true,
    },
    insightSelectors: {
      type: 'array',
      description: 'Enabled Insights types and their event categories',
      items: {
        type: 'object',
        properties: {
          insightType: {
            type: 'string',
            description: 'ApiCallRateInsight or ApiErrorRateInsight',
          },
          eventCategories: {
            type: 'array',
            description: 'Event categories the Insights type applies to: Management, Data, or both',
          },
        },
      },
    },
  },
}
