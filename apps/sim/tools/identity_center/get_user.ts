import type {
  IdentityCenterGetUserParams,
  IdentityCenterGetUserResponse,
} from '@/tools/identity_center/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const getUserTool: InternalToolConfig<
  IdentityCenterGetUserParams,
  IdentityCenterGetUserResponse
> = {
  id: 'identity_center_get_user',
  name: 'Identity Center Get User',
  description: 'Look up a user in the Identity Store by email address',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the user to look up',
    },
  },

  operation: {
    input: (params) => ({
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
        givenName: data.givenName ?? null,
        familyName: data.familyName ?? null,
        userStatus: data.userStatus ?? null,
        title: data.title ?? null,
        externalIds: data.externalIds ?? [],
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'Identity Store user ID (use as principalId)' },
    userName: { type: 'string', description: 'Username in the Identity Store' },
    displayName: { type: 'string', description: 'Display name of the user', optional: true },
    email: { type: 'string', description: 'Email address of the user', optional: true },
    givenName: {
      type: 'string',
      description: 'Given (first) name, or null when the Identity Store omits it',
      optional: true,
    },
    familyName: {
      type: 'string',
      description: 'Family (last) name, or null when the Identity Store omits it',
      optional: true,
    },
    userStatus: {
      type: 'string',
      description: 'Account status (ENABLED or DISABLED)',
      optional: true,
    },
    title: { type: 'string', description: 'Job title of the user', optional: true },
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
