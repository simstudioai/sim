import type {
  CloudTrailGetEventDataStoreParams,
  CloudTrailGetEventDataStoreResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const getEventDataStoreTool: InternalToolConfig<
  CloudTrailGetEventDataStoreParams,
  CloudTrailGetEventDataStoreResponse
> = {
  id: 'cloudtrail_get_event_data_store',
  name: 'CloudTrail Get Event Data Store',
  description: 'Retrieve the configuration of a single CloudTrail Lake event data store',
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
    eventDataStore: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event data store ARN, or the ID suffix of that ARN',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      eventDataStore: params.eventDataStore,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudTrail event data store')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    eventDataStoreArn: {
      type: 'string',
      description: 'ARN of the event data store',
      optional: true,
    },
    name: {
      type: 'string',
      description: 'Name of the event data store',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'CREATED, ENABLED, PENDING_DELETION, or an ingestion state',
      optional: true,
    },
    advancedEventSelectors: {
      type: 'array',
      description: 'Advanced event selectors that define what the store ingests',
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
    multiRegionEnabled: {
      type: 'boolean',
      description: 'Whether the store collects events from all Regions',
      optional: true,
    },
    organizationEnabled: {
      type: 'boolean',
      description: 'Whether the store collects events for the organization',
      optional: true,
    },
    retentionPeriod: {
      type: 'number',
      description: 'Retention period in days',
      optional: true,
    },
    terminationProtectionEnabled: {
      type: 'boolean',
      description: 'Whether termination protection is enabled',
      optional: true,
    },
    createdTimestamp: {
      type: 'string',
      description: 'When the store was created (ISO 8601)',
      optional: true,
    },
    updatedTimestamp: {
      type: 'string',
      description: 'When the store was last updated (ISO 8601)',
      optional: true,
    },
    kmsKeyId: {
      type: 'string',
      description: 'KMS key used to encrypt the store',
      optional: true,
    },
    billingMode: {
      type: 'string',
      description: 'EXTENDABLE_RETENTION_PRICING or FIXED_RETENTION_PRICING',
      optional: true,
    },
    federationStatus: {
      type: 'string',
      description: 'Lake Formation federation status',
      optional: true,
    },
    federationRoleArn: {
      type: 'string',
      description: 'ARN of the role used for Lake Formation federation',
      optional: true,
    },
    partitionKeys: {
      type: 'array',
      description: 'Partition keys of the event data store',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partition key name' },
          type: { type: 'string', description: 'Partition key data type' },
        },
      },
    },
  },
}
