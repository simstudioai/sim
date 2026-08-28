import type {
  MicrosoftAdAddUserAppRoleAssignmentParams,
  MicrosoftAdAddUserAppRoleAssignmentResponse,
} from '@/tools/microsoft_ad/types'
import { APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/** Projects a Microsoft Graph `appRoleAssignment` onto the documented subset of fields. */
export function mapAppRoleAssignment(assignment: Record<string, unknown>): Record<string, unknown> {
  return {
    id: assignment.id ?? null,
    appRoleId: assignment.appRoleId ?? null,
    createdDateTime: assignment.createdDateTime ?? null,
    principalId: assignment.principalId ?? null,
    principalDisplayName: assignment.principalDisplayName ?? null,
    principalType: assignment.principalType ?? null,
    resourceId: assignment.resourceId ?? null,
    resourceDisplayName: assignment.resourceDisplayName ?? null,
  }
}

/** Reads and validates the three identifiers the grant needs, before any network call. */
export function readIdentifiers(params: MicrosoftAdAddUserAppRoleAssignmentParams) {
  const userId = params.userId?.trim()
  const resourceId = params.resourceId?.trim()
  const appRoleId = params.appRoleId?.trim()
  if (!userId) throw new Error('User ID is required')
  if (!resourceId) throw new Error('Resource ID is required')
  if (!appRoleId) throw new Error('App role ID is required')
  return { userId, resourceId, appRoleId }
}

export const addUserAppRoleAssignmentTool: InternalToolConfig<
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
      description:
        'Object ID or user principal name of the user to grant the app role to. A user principal name is resolved to its object ID before the grant.',
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
  /**
   * `appRoleAssignment.principalId` is an `Edm.Guid`, so it accepts only the user's object ID —
   * unlike the `/users/{id | userPrincipalName}` path segment, which accepts either. Sending the
   * userPrincipalName this tool invites in both directions produced a 400 on every UPN-driven
   * grant, so the UPN is resolved to its object ID first and only the GUID reaches the body.
   * @see https://learn.microsoft.com/en-us/graph/api/user-post-approleassignments
   */
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    assignment: {
      type: 'object',
      description: 'The created app role assignment',
      properties: APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES,
    },
  },
}
