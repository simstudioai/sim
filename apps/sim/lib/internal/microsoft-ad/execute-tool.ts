import { executeAddUserAppRoleAssignmentOperation } from '@/lib/internal/microsoft-ad/operations/add-user-app-role-assignment'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeMicrosoftAdTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'microsoft_ad_add_user_app_role_assignment':
      return executeToolOperationImplementation(executeAddUserAppRoleAssignmentOperation, request)
    default:
      return Response.json(
        { success: false, error: `Unsupported microsoft-ad tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
