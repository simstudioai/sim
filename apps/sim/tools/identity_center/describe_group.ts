import type {
  IdentityCenterDescribeGroupParams,
  IdentityCenterDescribeGroupResponse,
} from '@/tools/identity_center/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeGroupTool: InternalToolConfig<
  IdentityCenterDescribeGroupParams,
  IdentityCenterDescribeGroupResponse
> = {
  id: 'identity_center_describe_group',
  name: 'Identity Center Describe Group',
  description:
    'Resolve an Identity Store group ID to the group behind it. Use to turn the principalId on an account assignment into a group name.',
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
      description: 'Identity Store group ID, such as the principalId on a GROUP account assignment',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      identityStoreId: params.identityStoreId,
      groupId: params.groupId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe group')
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
    groupId: { type: 'string', description: 'Identity Store group ID' },
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
