import type {
  IdentityCenterGetUserParams,
  IdentityCenterGetUserResponse,
} from '@/tools/identity_center/types'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<IdentityCenterGetUserParams, IdentityCenterGetUserResponse> = {
  id: 'identity_center_get_user',
  name: 'Identity Center Get User',
  description: 'Look up a user in the Identity Store by email address',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the user to look up',
    },
  },

  request: {
    url: '/api/tools/identity-center/get-user',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      identityStoreId: params.identityStoreId,
      email: params.email,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get user from Identity Store')
    }
    return {
      success: true,
      output: {
        userId: data.userId ?? '',
        userName: data.userName ?? '',
        displayName: data.displayName ?? null,
        email: data.email ?? null,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Identity Store user ID (use as principalId)' },
    userName: { type: 'string', description: 'Username in the Identity Store' },
    displayName: { type: 'string', description: 'Display name of the user', optional: true },
    email: { type: 'string', description: 'Email address of the user', optional: true },
  },
}
