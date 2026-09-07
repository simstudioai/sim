import type {
  CloudTrailLookupEventsParams,
  CloudTrailLookupEventsResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const lookupEventsTool: InternalToolConfig<
  CloudTrailLookupEventsParams,
  CloudTrailLookupEventsResponse
> = {
  id: 'cloudtrail_lookup_events',
  name: 'CloudTrail Look Up Events',
  description:
    'Look up AWS CloudTrail management or Insights events from the last 90 days in a Region',
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
    attributeKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Lookup attribute to filter on: AccessKeyId, EventId, EventName, EventSource, ReadOnly, ResourceName, ResourceType, or Username. Must be paired with attributeValue',
    },
    attributeValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Value the lookup attribute must equal. Must be paired with attributeKey',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return events at or after this ISO 8601 timestamp',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return events at or before this ISO 8601 timestamp',
    },
    eventCategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to the value insight to return CloudTrail Insights events instead of management events',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of events to return, 1 to 50 (default 50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous lookup, which must repeat the same filters',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.attributeKey && { attributeKey: params.attributeKey }),
      ...(params.attributeValue && { attributeValue: params.attributeValue }),
      ...(params.startTime && { startTime: params.startTime }),
      ...(params.endTime && { endTime: params.endTime }),
      ...(params.eventCategory === 'insight' && { eventCategory: 'insight' as const }),
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to look up CloudTrail events')
    }
    return {
      success: true,
      output: {
        events: data.output.events ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Matching events, most recent first',
      items: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'CloudTrail event ID' },
          eventName: { type: 'string', description: 'API action that was called' },
          readOnly: {
            type: 'string',
            description: "Whether the action was read-only, as the string 'true' or 'false'",
          },
          accessKeyId: {
            type: 'string',
            description: 'Access key ID used to make the call, when applicable',
          },
          eventTime: { type: 'string', description: 'When the event occurred (ISO 8601)' },
          eventSource: {
            type: 'string',
            description: 'AWS service endpoint that recorded the event',
          },
          username: { type: 'string', description: 'Name of the principal that made the call' },
          resources: {
            type: 'array',
            description: 'Resources referenced by the event, as resourceType and resourceName',
          },
          cloudTrailEvent: {
            type: 'object',
            description:
              'Full CloudTrail event record parsed from JSON, including userIdentity, sourceIPAddress, userAgent, requestParameters, responseElements, and errorCode',
          },
          cloudTrailEventRaw: {
            type: 'string',
            description:
              'Raw CloudTrail event JSON string, populated only when it could not be parsed',
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of events',
      optional: true,
    },
  },
}
