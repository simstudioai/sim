import type {
  MicrosoftAdDeleteGroupParams,
  MicrosoftAdDeleteGroupResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const deleteGroupTool: ToolConfig<
  MicrosoftAdDeleteGroupParams,
  MicrosoftAdDeleteGroupResponse
> = {
  id: 'microsoft_ad_delete_group',
  name: 'Delete Azure AD Group',
  description:
    'Delete a group from Azure AD (Microsoft Entra ID). Microsoft 365 and security groups can be restored within 30 days.',
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
  },
  request: {
    url: (params) => {
      const groupId = params.groupId?.trim()
      if (!groupId) throw new Error('Group ID is required')
      return `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (_response: Response, params?: MicrosoftAdDeleteGroupParams) => {
    return {
      success: true,
      output: {
        deleted: true,
        groupId: params?.groupId ?? '',
      },
    }
  },
  outputs: {
    deleted: { type: 'boolean', description: 'Whether the deletion was successful' },
    groupId: { type: 'string', description: 'ID of the deleted group' },
  },
}
