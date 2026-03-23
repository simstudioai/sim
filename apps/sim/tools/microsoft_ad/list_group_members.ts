import type {
  MicrosoftAdListGroupMembersParams,
  MicrosoftAdListGroupMembersResponse,
} from '@/tools/microsoft_ad/types'
import { MEMBER_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const listGroupMembersTool: ToolConfig<
  MicrosoftAdListGroupMembersParams,
  MicrosoftAdListGroupMembersResponse
> = {
  id: 'microsoft_ad_list_group_members',
  name: 'List Azure AD Group Members',
  description: 'List members of a group in Azure AD (Microsoft Entra ID)',
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
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of members to return (default 100, max 999)',
    },
  },
  request: {
    url: (params) => {
      const groupId = params.groupId?.trim()
      if (!groupId) throw new Error('Group ID is required')
      const queryParts = ['$select=id,displayName,mail']
      if (params.top) queryParts.push(`$top=${params.top}`)
      return `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}/members?${queryParts.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const members = (data.value ?? []).map((member: Record<string, unknown>) => ({
      id: member.id ?? null,
      displayName: member.displayName ?? null,
      mail: member.mail ?? null,
      odataType: (member['@odata.type'] as string) ?? null,
    }))
    return {
      success: true,
      output: {
        members,
        memberCount: members.length,
      },
    }
  },
  outputs: {
    members: {
      type: 'array',
      description: 'List of group members',
      properties: MEMBER_OUTPUT_PROPERTIES,
    },
    memberCount: { type: 'number', description: 'Number of members returned' },
  },
}
