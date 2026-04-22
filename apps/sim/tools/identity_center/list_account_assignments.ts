import type {
  IdentityCenterListAccountAssignmentsParams,
  IdentityCenterListAccountAssignmentsResponse,
} from '@/tools/identity_center/types'
import type { ToolConfig } from '@/tools/types'

export const listAccountAssignmentsTool: ToolConfig<
  IdentityCenterListAccountAssignmentsParams,
  IdentityCenterListAccountAssignmentsResponse
> = {
  id: 'identity_center_list_account_assignments',
  name: 'Identity Center List Account Assignments',
  description: 'List all account assignments for a specific user or group across all accounts',
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
    principalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity Store ID of the user or group',
    },
    principalType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of principal: USER or GROUP',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of assignments to return',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  request: {
    url: '/api/tools/identity-center/list-account-assignments',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      instanceArn: params.instanceArn,
      principalId: params.principalId,
      principalType: params.principalType,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list account assignments')
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
      type: 'json',
      description:
        'List of account assignments with accountId, permissionSetArn, principalType, principalId',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of assignments returned' },
  },
}
