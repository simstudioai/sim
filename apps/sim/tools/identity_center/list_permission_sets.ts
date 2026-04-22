import type {
  IdentityCenterListPermissionSetsParams,
  IdentityCenterListPermissionSetsResponse,
} from '@/tools/identity_center/types'
import type { ToolConfig } from '@/tools/types'

export const listPermissionSetsTool: ToolConfig<
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
      description: 'Maximum number of permission sets to return',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  request: {
    url: '/api/tools/identity-center/list-permission-sets',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
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
      type: 'json',
      description:
        'List of permission sets with permissionSetArn, name, description, sessionDuration',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of permission sets returned' },
  },
}
