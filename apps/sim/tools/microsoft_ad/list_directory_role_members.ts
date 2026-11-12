import type {
  MicrosoftAdListDirectoryRoleMembersParams,
  MicrosoftAdListDirectoryRoleMembersResponse,
} from '@/tools/microsoft_ad/types'
import { MEMBER_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { mapDirectoryObjectMember } from '@/tools/microsoft_ad/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listDirectoryRoleMembersTool: ToolConfig<
  MicrosoftAdListDirectoryRoleMembersParams,
  MicrosoftAdListDirectoryRoleMembersResponse
> = {
  id: 'microsoft_ad_list_directory_role_members',
  name: 'List Microsoft Entra ID Directory Role Members',
  description:
    'List the principals holding an administrator role. Returns up to 1000 members; this endpoint does not support paging.',
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
    directoryRoleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the directory role. Use List Directory Roles to find it.',
    },
  },
  request: {
    url: (params) => {
      const directoryRoleId = params.directoryRoleId?.trim()
      if (!directoryRoleId) throw new Error('Directory role ID is required')
      return `https://graph.microsoft.com/v1.0/directoryRoles/${safeUrlPathSegment(directoryRoleId, 'directoryRoleId')}/members?$select=id,displayName,mail,userPrincipalName`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const members = (data.value ?? []).map(mapDirectoryObjectMember)
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
      description: 'Principals holding the directory role',
      items: {
        type: 'object',
        properties: MEMBER_OUTPUT_PROPERTIES,
      },
    },
    memberCount: { type: 'number', description: 'Number of members returned' },
  },
}
