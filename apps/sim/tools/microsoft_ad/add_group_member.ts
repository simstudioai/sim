import type {
  MicrosoftAdAddGroupMemberParams,
  MicrosoftAdAddGroupMemberResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const addGroupMemberTool: ToolConfig<
  MicrosoftAdAddGroupMemberParams,
  MicrosoftAdAddGroupMemberResponse
> = {
  id: 'microsoft_ad_add_group_member',
  name: 'Add Azure AD Group Member',
  description: 'Add a member to a group in Azure AD (Microsoft Entra ID)',
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
    memberId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID of the member to add',
    },
  },
  request: {
    url: (params) => {
      const groupId = params.groupId?.trim()
      if (!groupId) throw new Error('Group ID is required')
      return `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}/members/$ref`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const memberId = params.memberId?.trim()
      if (!memberId) throw new Error('Member ID is required')
      return {
        '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${memberId}`,
      }
    },
  },
  transformResponse: async (_response: Response, params?: MicrosoftAdAddGroupMemberParams) => {
    return {
      success: true,
      output: {
        added: true,
        groupId: params?.groupId ?? '',
        memberId: params?.memberId ?? '',
      },
    }
  },
  outputs: {
    added: { type: 'boolean', description: 'Whether the member was added successfully' },
    groupId: { type: 'string', description: 'Group ID' },
    memberId: { type: 'string', description: 'Member ID that was added' },
  },
}
