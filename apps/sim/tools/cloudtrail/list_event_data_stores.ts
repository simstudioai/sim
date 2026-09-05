import type {
  CloudTrailListEventDataStoresParams,
  CloudTrailListEventDataStoresResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const listEventDataStoresTool: InternalToolConfig<
  CloudTrailListEventDataStoresParams,
  CloudTrailListEventDataStoresResponse
> = {
  id: 'cloudtrail_list_event_data_stores',
  name: 'CloudTrail List Event Data Stores',
  description: 'List the CloudTrail Lake event data stores in the account for the current Region',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum event data stores to return on a single page, 1 to 1000',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous list request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CloudTrail event data stores')
    }
    return {
      success: true,
      output: {
        eventDataStores: data.output.eventDataStores ?? [],
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    eventDataStores: {
      type: 'array',
      description: 'Event data stores in the account for the current Region',
      items: {
        type: 'object',
        properties: {
          eventDataStoreArn: { type: 'string', description: 'ARN of the event data store' },
          name: { type: 'string', description: 'Name of the event data store' },
          status: {
            type: 'string',
            description: 'CREATED, ENABLED, PENDING_DELETION, or an ingestion state',
          },
          advancedEventSelectors: {
            type: 'array',
            description: 'Advanced event selectors that define what the store ingests',
          },
          multiRegionEnabled: {
            type: 'boolean',
            description: 'Whether the store collects events from all Regions',
          },
          organizationEnabled: {
            type: 'boolean',
            description: 'Whether the store collects events for the organization',
          },
          retentionPeriod: { type: 'number', description: 'Retention period in days' },
          terminationProtectionEnabled: {
            type: 'boolean',
            description: 'Whether termination protection is enabled',
          },
          createdTimestamp: {
            type: 'string',
            description: 'When the store was created (ISO 8601)',
          },
          updatedTimestamp: {
            type: 'string',
            description: 'When the store was last updated (ISO 8601)',
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of event data stores',
      optional: true,
    },
  },
}
