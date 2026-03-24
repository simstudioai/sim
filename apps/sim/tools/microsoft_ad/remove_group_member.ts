import type {
  MicrosoftAdRemoveGroupMemberParams,
  MicrosoftAdRemoveGroupMemberResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const removeGroupMemberTool: ToolConfig<
  MicrosoftAdRemoveGroupMemberParams,
  MicrosoftAdRemoveGroupMemberResponse
> = {
  id: 'microsoft_ad_remove_group_member',
  name: 'Remove Azure AD Group Member',
  description: 'Remove a member from a group in Azure AD (Microsoft Entra ID)',
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
      description: 'User ID of the member to remove',
    },
  },
  request: {
    url: (params) => {
      const groupId = params.groupId?.trim()
      const memberId = params.memberId?.trim()
      if (!groupId) throw new Error('Group ID is required')
      if (!memberId) throw new Error('Member ID is required')
      return `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/$ref`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (_response: Response, params?: MicrosoftAdRemoveGroupMemberParams) => {
    return {
      success: true,
      output: {
        removed: true,
        groupId: params?.groupId ?? '',
        memberId: params?.memberId ?? '',
      },
    }
  },
  outputs: {
    removed: { type: 'boolean', description: 'Whether the member was removed successfully' },
    groupId: { type: 'string', description: 'Group ID' },
    memberId: { type: 'string', description: 'Member ID that was removed' },
  },
}
