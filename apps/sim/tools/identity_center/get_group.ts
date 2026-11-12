import type {
  IdentityCenterGetGroupParams,
  IdentityCenterGetGroupResponse,
} from '@/tools/identity_center/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const getGroupTool: InternalToolConfig<
  IdentityCenterGetGroupParams,
  IdentityCenterGetGroupResponse
> = {
  id: 'identity_center_get_group',
  name: 'Identity Center Get Group',
  description: 'Look up a group in the Identity Store by display name',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name of the group to look up',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      identityStoreId: params.identityStoreId,
      displayName: params.displayName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get group from Identity Store')
    }
    return {
      success: true,
      output: {
        groupId: data.groupId ?? '',
        displayName: data.displayName ?? null,
        description: data.description ?? null,
        externalIds: data.externalIds ?? [],
      },
    }
  },

  outputs: {
    groupId: { type: 'string', description: 'Identity Store group ID (use as principalId)' },
    displayName: { type: 'string', description: 'Display name of the group', optional: true },
    description: { type: 'string', description: 'Group description', optional: true },
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
}
