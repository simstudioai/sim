import type {
  IdentityCenterListGroupsParams,
  IdentityCenterListGroupsResponse,
} from '@/tools/identity_center/types'
import type { InternalToolConfig } from '@/tools/types'

export const listGroupsTool: InternalToolConfig<
  IdentityCenterListGroupsParams,
  IdentityCenterListGroupsResponse
> = {
  id: 'identity_center_list_groups',
  name: 'Identity Center List Groups',
  description: 'List all groups in the Identity Store',
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
      description: 'Identity Store ID (from the Identity Center instance)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of groups to return (1-100)',
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
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to list groups')
    }
    return {
      success: true,
      output: {
        groups: data.groups ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    groups: {
      type: 'array',
      description: 'Groups in the Identity Store',
      items: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: 'Identity Store group ID (use as principalId)' },
          displayName: { type: 'string', description: 'Group display name', nullable: true },
          description: { type: 'string', description: 'Group description', nullable: true },
          externalIds: {
            type: 'array',
            description: 'External identity provider IDs linked to the group',
            items: {
              type: 'object',
              properties: {
                issuer: { type: 'string', description: 'Identity provider that issued the ID' },
                id: { type: 'string', description: 'Identifier at the issuer' },
              },
            },
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of groups returned' },
  },
}
