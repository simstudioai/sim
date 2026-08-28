import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import {
  mapAppRoleAssignment,
  readIdentifiers,
} from '@/tools/microsoft_ad/add_user_app_role_assignment'
import type {
  MicrosoftAdAddUserAppRoleAssignmentParams,
  MicrosoftAdAddUserAppRoleAssignmentResponse,
} from '@/tools/microsoft_ad/types'
import { extractGraphErrorMessage, resolveGraphUserObjectId } from '@/tools/microsoft_ad/utils'

export const executeAddUserAppRoleAssignmentOperation: InternalToolOperationImplementation<
  MicrosoftAdAddUserAppRoleAssignmentParams
> = async (params, signal): Promise<MicrosoftAdAddUserAppRoleAssignmentResponse> => {
  const { userId, resourceId, appRoleId } = readIdentifiers(params)
  const principalId = await resolveGraphUserObjectId(userId, params.accessToken, signal)

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/appRoleAssignments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ principalId, resourceId, appRoleId }),
      signal,
    }
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(extractGraphErrorMessage(body, 'Failed to grant the app role to the user'))
  }

  return { success: true, output: { assignment: mapAppRoleAssignment(body) } }
}
