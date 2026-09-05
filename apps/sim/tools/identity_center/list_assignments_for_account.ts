import type {
  IdentityCenterListAccountAssignmentsResponse,
  IdentityCenterListAssignmentsForAccountParams,
} from '@/tools/identity_center/types'
import type { InternalToolConfig } from '@/tools/types'

export const listAssignmentsForAccountTool: InternalToolConfig<
  IdentityCenterListAssignmentsForAccountParams,
  IdentityCenterListAccountAssignmentsResponse
> = {
  id: 'identity_center_list_assignments_for_account',
  name: 'Identity Center List Assignments For Account',
  description:
    'List every principal assigned a specific permission set on a specific AWS account. Use for per-account access reviews.',
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
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'AWS account ID to list assignments for (12 digits)',
    },
    permissionSetArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ARN of the permission set to list assignments for',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of assignments to return (1-100)',
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
      accountId: params.accountId,
      permissionSetArn: params.permissionSetArn,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list assignments for account')
    }
    return {
      success: true,
      output: {
        assignments: data.assignments ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    assignments: {
      type: 'array',
      description: 'Principals assigned this permission set on the account',
      items: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'AWS account ID' },
          permissionSetArn: { type: 'string', description: 'Permission set ARN' },
          principalType: { type: 'string', description: 'Principal type (USER or GROUP)' },
          principalId: {
            type: 'string',
            description:
              'Identity Store user or group ID — resolve with Describe User or Describe Group',
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of assignments returned' },
  },
}
