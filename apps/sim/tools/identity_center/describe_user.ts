import type {
  IdentityCenterDescribeUserParams,
  IdentityCenterDescribeUserResponse,
} from '@/tools/identity_center/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeUserTool: InternalToolConfig<
  IdentityCenterDescribeUserParams,
  IdentityCenterDescribeUserResponse
> = {
  id: 'identity_center_describe_user',
  name: 'Identity Center Describe User',
  description:
    'Resolve an Identity Store user ID to the user behind it. Use to turn the principalId on an account assignment into a name and email.',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity Store user ID, such as the principalId on a USER account assignment',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      identityStoreId: params.identityStoreId,
      userId: params.userId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe user')
    }
    return {
      success: true,
      output: {
        userId: data.userId ?? '',
        userName: data.userName ?? '',
        displayName: data.displayName ?? null,
        email: data.email ?? null,
        userStatus: data.userStatus ?? null,
        title: data.title ?? null,
        externalIds: data.externalIds ?? [],
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Identity Store user ID' },
    userName: { type: 'string', description: 'Username in the Identity Store' },
    displayName: {
      type: 'string',
      description: 'Display name of the user, or null when the Identity Store omits it',
      nullable: true,
    },
    email: {
      type: 'string',
      description: 'Primary email address, or null when the user has no email attribute',
      nullable: true,
    },
    userStatus: {
      type: 'string',
      description: 'Account status (ENABLED or DISABLED), or null when the Identity Store omits it',
      nullable: true,
    },
    title: {
      type: 'string',
      description: 'Job title, or null when the Identity Store omits it',
      nullable: true,
    },
    externalIds: {
      type: 'array',
      description: 'External identity provider IDs linked to the user',
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
