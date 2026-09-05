import type {
  IdentityCenterListPermissionSetsParams,
  IdentityCenterListPermissionSetsResponse,
} from '@/tools/identity_center/types'
import type { InternalToolConfig } from '@/tools/types'

export const listPermissionSetsTool: InternalToolConfig<
  IdentityCenterListPermissionSetsParams,
  IdentityCenterListPermissionSetsResponse
> = {
  id: 'identity_center_list_permission_sets',
  name: 'Identity Center List Permission Sets',
  description: 'List all permission sets defined in an IAM Identity Center instance',
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
    instanceArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ARN of the Identity Center instance',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of permission sets to return (1-100)',
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
      instanceArn: params.instanceArn,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list permission sets')
    }
    return {
      success: true,
      output: {
        permissionSets: data.permissionSets ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    permissionSets: {
      type: 'array',
      description: 'Permission sets defined on the instance',
      items: {
        type: 'object',
        properties: {
          permissionSetArn: { type: 'string', description: 'ARN of the permission set' },
          name: { type: 'string', description: 'Permission set name' },
          description: {
            type: 'string',
            description: 'Permission set description',
            nullable: true,
          },
          sessionDuration: {
            type: 'string',
            description: 'ISO 8601 session duration (e.g., PT1H)',
            nullable: true,
          },
          createdDate: {
            type: 'string',
            description: 'ISO 8601 date the permission set was created',
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
    count: { type: 'number', description: 'Number of permission sets returned' },
  },
}
