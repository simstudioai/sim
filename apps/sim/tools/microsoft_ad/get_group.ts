import type {
  MicrosoftAdGetGroupParams,
  MicrosoftAdGetGroupResponse,
} from '@/tools/microsoft_ad/types'
import { GROUP_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const getGroupTool: ToolConfig<MicrosoftAdGetGroupParams, MicrosoftAdGetGroupResponse> = {
  id: 'microsoft_ad_get_group',
  name: 'Get Azure AD Group',
  description: 'Get a group by ID from Azure AD (Microsoft Entra ID)',
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
      return `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}?$select=id,displayName,description,mail,mailEnabled,mailNickname,securityEnabled,groupTypes,visibility,createdDateTime`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const group = await response.json()
    return {
      success: true,
      output: {
        group: {
          id: group.id ?? null,
          displayName: group.displayName ?? null,
          description: group.description ?? null,
          mail: group.mail ?? null,
          mailEnabled: group.mailEnabled ?? null,
          mailNickname: group.mailNickname ?? null,
          securityEnabled: group.securityEnabled ?? null,
          groupTypes: group.groupTypes ?? [],
          visibility: group.visibility ?? null,
          createdDateTime: group.createdDateTime ?? null,
        },
      },
    }
  },
  outputs: {
    group: {
      type: 'object',
      description: 'Group details',
      properties: GROUP_OUTPUT_PROPERTIES,
    },
  },
}
