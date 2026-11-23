import { ZENDESK_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  USER_OUTPUT_PROPERTIES,
  ZENDESK_CREDENTIAL_PARAMS,
  zendeskAuthorization,
} from '@/tools/zendesk/types'

export interface ZendeskGetCurrentUserParams {
  email: string
  apiToken: string
  subdomain: string
}

export interface ZendeskGetCurrentUserResponse {
  success: boolean
  output: {
    user: any
    user_id: number
    success: boolean
  }
}

export const zendeskGetCurrentUserTool: ToolConfig<
  ZendeskGetCurrentUserParams,
  ZendeskGetCurrentUserResponse
> = {
  id: 'zendesk_get_current_user',
  name: 'Get Current User from Zendesk',
  description: 'Get the currently authenticated user from Zendesk',
  version: '1.0.0',

  oauth: ZENDESK_CREDENTIAL_OAUTH,

  params: {
    ...ZENDESK_CREDENTIAL_PARAMS,
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zendesk API token',
    },
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk subdomain',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/users/me'),
    method: 'GET',
    headers: (params) => ({
      Authorization: zendeskAuthorization(params),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'get_current_user')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        user: data.user,
        user_id: data.user?.id,
        success: true,
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'Current user object',
      properties: USER_OUTPUT_PROPERTIES,
    },
    user_id: { type: 'number', description: 'The current user ID' },
  },
}
