import type {
  MicrosoftAdAddDirectoryRoleMemberParams,
  MicrosoftAdAddDirectoryRoleMemberResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const addDirectoryRoleMemberTool: ToolConfig<
  MicrosoftAdAddDirectoryRoleMemberParams,
  MicrosoftAdAddDirectoryRoleMemberResponse
> = {
  id: 'microsoft_ad_add_directory_role_member',
  name: 'Add Microsoft Entra ID Directory Role Member',
  description:
    'Grant a user an administrator role in Microsoft Entra ID. This is a privileged change that expands what the user can do across the tenant.',
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
    memberId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the user to grant the role to',
    },
  },
  request: {
    url: (params) => {
      const directoryRoleId = params.directoryRoleId?.trim()
      if (!directoryRoleId) throw new Error('Directory role ID is required')
      return `https://graph.microsoft.com/v1.0/directoryRoles/${encodeURIComponent(directoryRoleId)}/members/$ref`
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
  transformResponse: async (
    _response: Response,
    params?: MicrosoftAdAddDirectoryRoleMemberParams
  ) => {
    return {
      success: true,
      output: {
        added: true,
        directoryRoleId: params?.directoryRoleId ?? '',
        memberId: params?.memberId ?? '',
      },
    }
  },
  outputs: {
    added: { type: 'boolean', description: 'Whether the member was added successfully' },
    directoryRoleId: { type: 'string', description: 'ID of the directory role' },
    memberId: { type: 'string', description: 'ID of the member that was added' },
  },
}
