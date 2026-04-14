import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetUserParams {
  accessToken: string
  domain: string
  accountId: string
  cloudId?: string
}

export interface ConfluenceGetUserResponse {
  success: boolean
  output: {
    ts: string
    accountId: string
    displayName: string
    email: string | null
    accountType: string | null
    profilePicture: string | null
    publicName: string | null
  }
}

export const confluenceGetUserTool: ToolConfig<ConfluenceGetUserParams, ConfluenceGetUserResponse> =
  {
    id: 'confluence_get_user',
    name: 'Confluence Get User',
    description: 'Get display name and profile info for a Confluence user by account ID.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'confluence',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for Confluence',
      },
      domain: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
      },
      accountId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The Atlassian account ID of the user to look up',
      },
      cloudId: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
      },
    },

    request: {
      url: () => '/api/tools/confluence/user',
      method: 'POST',
      headers: (params: ConfluenceGetUserParams) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }),
      body: (params: ConfluenceGetUserParams) => ({
        domain: params.domain,
        accessToken: params.accessToken,
        accountId: params.accountId?.trim(),
        cloudId: params.cloudId,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          accountId: data.accountId ?? '',
          displayName: data.displayName ?? '',
          email: data.email ?? null,
          accountType: data.accountType ?? null,
          profilePicture: data.profilePicture?.path ?? null,
          publicName: data.publicName ?? null,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      accountId: { type: 'string', description: 'Atlassian account ID of the user' },
      displayName: { type: 'string', description: 'Display name of the user' },
      email: { type: 'string', description: 'Email address of the user', optional: true },
      accountType: {
        type: 'string',
        description: 'Account type (e.g., atlassian, app, customer)',
        optional: true,
      },
      profilePicture: {
        type: 'string',
        description: 'Path to the user profile picture',
        optional: true,
      },
      publicName: { type: 'string', description: 'Public name of the user', optional: true },
    },
  }
