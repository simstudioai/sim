import type {
  MicrosoftAdAddUserAppRoleAssignmentParams,
  MicrosoftAdAddUserAppRoleAssignmentResponse,
} from '@/tools/microsoft_ad/types'
import { APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const addUserAppRoleAssignmentTool: ToolConfig<
  MicrosoftAdAddUserAppRoleAssignmentParams,
  MicrosoftAdAddUserAppRoleAssignmentResponse
> = {
  id: 'microsoft_ad_add_user_app_role_assignment',
  name: 'Grant Microsoft Entra ID App Role To User',
  description:
    'Grant a user an application role on a service principal, giving them access to that application',
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
      description: 'User ID or user principal name to grant the app role to',
    },
    resourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Object ID of the resource service principal that defines the app role. Use List Service Principals to find it.',
    },
    appRoleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ID of the app role to grant. Use the all-zero GUID 00000000-0000-0000-0000-000000000000 to assign access without a specific role.',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/appRoleAssignments`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const resourceId = params.resourceId?.trim()
      const appRoleId = params.appRoleId?.trim()
      const principalId = params.userId?.trim()
      if (!resourceId) throw new Error('Resource ID is required')
      if (!appRoleId) throw new Error('App role ID is required')
      return { principalId, resourceId, appRoleId }
    },
  },
  transformResponse: async (response: Response) => {
    const assignment = await response.json()
    return {
      success: true,
      output: {
        assignment: {
          id: assignment.id ?? null,
          appRoleId: assignment.appRoleId ?? null,
          createdDateTime: assignment.createdDateTime ?? null,
          principalId: assignment.principalId ?? null,
          principalDisplayName: assignment.principalDisplayName ?? null,
          principalType: assignment.principalType ?? null,
          resourceId: assignment.resourceId ?? null,
          resourceDisplayName: assignment.resourceDisplayName ?? null,
        },
      },
    }
  },
  outputs: {
    assignment: {
      type: 'object',
      description: 'The created app role assignment',
      properties: APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES,
    },
  },
}
