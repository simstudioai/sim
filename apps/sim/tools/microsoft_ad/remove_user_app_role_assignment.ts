import type {
  MicrosoftAdRemoveUserAppRoleAssignmentParams,
  MicrosoftAdRemoveUserAppRoleAssignmentResponse,
} from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const removeUserAppRoleAssignmentTool: ToolConfig<
  MicrosoftAdRemoveUserAppRoleAssignmentParams,
  MicrosoftAdRemoveUserAppRoleAssignmentResponse
> = {
  id: 'microsoft_ad_remove_user_app_role_assignment',
  name: 'Revoke Microsoft Entra ID App Role From User',
  description:
    "Revoke an application role assignment from a user, removing their access to that application. Takes the assignment's own ID, not the app role ID.",
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID or user principal name the assignment belongs to',
    },
    appRoleAssignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ID of the app role assignment to remove, taken from the "id" field of List User App Role Assignments',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      const appRoleAssignmentId = params.appRoleAssignmentId?.trim()
      if (!userId) throw new Error('User ID is required')
      if (!appRoleAssignmentId) throw new Error('App role assignment ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/appRoleAssignments/${encodeURIComponent(appRoleAssignmentId)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (
    _response: Response,
    params?: MicrosoftAdRemoveUserAppRoleAssignmentParams
  ) => {
    return {
      success: true,
      output: {
        removed: true,
        userId: params?.userId ?? '',
        appRoleAssignmentId: params?.appRoleAssignmentId ?? '',
      },
    }
  },
  outputs: {
    removed: { type: 'boolean', description: 'Whether the assignment was removed successfully' },
    userId: { type: 'string', description: 'ID of the user the assignment belonged to' },
    appRoleAssignmentId: { type: 'string', description: 'ID of the removed app role assignment' },
  },
}
