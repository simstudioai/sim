import type {
  IdentityCenterListInstancesParams,
  IdentityCenterListInstancesResponse,
} from '@/tools/identity_center/types'
import type { InternalToolConfig } from '@/tools/types'

export const listInstancesTool: InternalToolConfig<
  IdentityCenterListInstancesParams,
  IdentityCenterListInstancesResponse
> = {
  id: 'identity_center_list_instances',
  name: 'Identity Center List Instances',
  description: 'List all AWS IAM Identity Center instances in your account',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of instances to return (1-100)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Identity Center instances')
    }
    return {
      success: true,
      output: {
        instances: data.instances ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    instances: {
      type: 'array',
      description: 'Identity Center instances in the region',
      items: {
        type: 'object',
        properties: {
          instanceArn: { type: 'string', description: 'ARN of the Identity Center instance' },
          identityStoreId: {
            type: 'string',
            description: 'Identity Store ID backing the instance',
          },
          name: { type: 'string', description: 'Instance name', nullable: true },
          status: { type: 'string', description: 'Instance status' },
          statusReason: {
            type: 'string',
            description: 'Explanation when the instance is not ACTIVE',
            nullable: true,
          },
          ownerAccountId: {
            type: 'string',
            description: 'AWS account that owns the instance',
            nullable: true,
          },
          createdDate: {
            type: 'string',
            description: 'ISO 8601 date the instance was created',
            nullable: true,
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of instances returned' },
  },
}
