import type {
  MicrosoftAdUpdateGroupParams,
  MicrosoftAdUpdateGroupResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const updateGroupTool: ToolConfig<
  MicrosoftAdUpdateGroupParams,
  MicrosoftAdUpdateGroupResponse
> = {
  id: 'microsoft_ad_update_group',
  name: 'Update Azure AD Group',
  description: 'Update group properties in Azure AD (Microsoft Entra ID)',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: {
    required: true,
    provider: 'microsoft-ad',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Microsoft Graph API access token',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group description',
    },
    mailNickname: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mail alias',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group visibility: "Private" or "Public"',
    },
  },
  request: {
    url: (params) => {
      const groupId = params.groupId?.trim()
      if (!groupId) throw new Error('Group ID is required')
      return `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.displayName) body.displayName = params.displayName
      if (params.description) body.description = params.description
      if (params.mailNickname) body.mailNickname = params.mailNickname
      if (params.visibility) body.visibility = params.visibility
      return body
    },
  },
  transformResponse: async (_response: Response, params?: MicrosoftAdUpdateGroupParams) => {
    return {
      success: true,
      output: {
        updated: true,
        groupId: params?.groupId ?? '',
      },
    }
  },
  outputs: {
    updated: { type: 'boolean', description: 'Whether the update was successful' },
    groupId: { type: 'string', description: 'ID of the updated group' },
  },
}
