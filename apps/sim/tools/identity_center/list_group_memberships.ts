import type {
  IdentityCenterListGroupMembershipsParams,
  IdentityCenterListGroupMembershipsResponse,
} from '@/tools/identity_center/types'
import type { InternalToolConfig } from '@/tools/types'

export const listGroupMembershipsTool: InternalToolConfig<
  IdentityCenterListGroupMembershipsParams,
  IdentityCenterListGroupMembershipsResponse
> = {
  id: 'identity_center_list_group_memberships',
  name: 'Identity Center List Group Memberships',
  description: 'List the users who belong to an Identity Store group',
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
    identityStoreId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity Store ID (e.g., d-1234567890)',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity Store group ID whose members to list',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of memberships to return (1-100)',
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
      identityStoreId: params.identityStoreId,
      groupId: params.groupId,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list group memberships')
    }
    return {
      success: true,
      output: {
        memberships: data.memberships ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    memberships: {
      type: 'array',
      description: 'Members of the group',
      items: {
        type: 'object',
        properties: {
          membershipId: { type: 'string', description: 'Identity Store membership ID' },
          groupId: { type: 'string', description: 'Identity Store group ID' },
          userId: {
            type: 'string',
            description:
              'Identity Store user ID of the member — resolve with Describe User. Null when the member is not a user.',
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
    count: { type: 'number', description: 'Number of memberships returned' },
  },
}
