import type {
  CloudTrailGetEventSelectorsParams,
  CloudTrailGetEventSelectorsResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const getEventSelectorsTool: InternalToolConfig<
  CloudTrailGetEventSelectorsParams,
  CloudTrailGetEventSelectorsResponse
> = {
  id: 'cloudtrail_get_event_selectors',
  name: 'CloudTrail Get Event Selectors',
  description:
    'Read which management, data, and network activity events a CloudTrail trail is configured to log',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Trail name or trail ARN',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      trailName: params.trailName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudTrail event selectors')
    }
    return {
      success: true,
      output: {
        trailArn: data.output.trailArn ?? null,
        eventSelectors: data.output.eventSelectors ?? [],
        advancedEventSelectors: data.output.advancedEventSelectors ?? [],
      },
    }
  },

  outputs: {
    trailArn: {
      type: 'string',
      description: 'ARN of the trail that owns these selectors',
      optional: true,
    },
    eventSelectors: {
      type: 'array',
      description: 'Basic event selectors configured on the trail',
      items: {
        type: 'object',
        properties: {
          readWriteType: {
            type: 'string',
            description: 'All, ReadOnly, or WriteOnly',
          },
          includeManagementEvents: {
            type: 'boolean',
            description: 'Whether management events are recorded',
          },
          dataResources: {
            type: 'array',
            description: 'Data resources logged by the selector, as type and values',
          },
          excludeManagementEventSources: {
            type: 'array',
            description: 'Event sources excluded from management event logging',
          },
        },
      },
    },
    advancedEventSelectors: {
      type: 'array',
      description: 'Advanced event selectors configured on the trail',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the advanced event selector' },
          fieldSelectors: {
            type: 'array',
            description:
              'Field selectors, each with field plus its equals, startsWith, endsWith, notEquals, notStartsWith, and notEndsWith values',
          },
        },
      },
    },
  },
}
