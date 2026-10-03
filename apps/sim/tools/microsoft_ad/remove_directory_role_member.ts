import type {
  MicrosoftAdRemoveDirectoryRoleMemberParams,
  MicrosoftAdRemoveDirectoryRoleMemberResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const removeDirectoryRoleMemberTool: ToolConfig<
  MicrosoftAdRemoveDirectoryRoleMemberParams,
  MicrosoftAdRemoveDirectoryRoleMemberResponse
> = {
  id: 'microsoft_ad_remove_directory_role_member',
  name: 'Remove Microsoft Entra ID Directory Role Member',
  description:
    'Revoke an administrator role from a user in Microsoft Entra ID. Removes only the role membership; the user account itself is not deleted.',
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
      description: 'Object ID of the user to remove the role from',
    },
  },
  request: {
    url: (params) => {
      const directoryRoleId = params.directoryRoleId?.trim()
      const memberId = params.memberId?.trim()
      if (!directoryRoleId) throw new Error('Directory role ID is required')
      if (!memberId) throw new Error('Member ID is required')
      return `https://graph.microsoft.com/v1.0/directoryRoles/${encodeURIComponent(directoryRoleId)}/members/${encodeURIComponent(memberId)}/$ref`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (
    _response: Response,
    params?: MicrosoftAdRemoveDirectoryRoleMemberParams
  ) => {
    return {
      success: true,
      output: {
        removed: true,
        directoryRoleId: params?.directoryRoleId ?? '',
        memberId: params?.memberId ?? '',
      },
    }
  },
  outputs: {
    removed: { type: 'boolean', description: 'Whether the member was removed successfully' },
    directoryRoleId: { type: 'string', description: 'ID of the directory role' },
    memberId: { type: 'string', description: 'ID of the member that was removed' },
  },
}
