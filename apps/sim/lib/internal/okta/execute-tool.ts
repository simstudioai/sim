import { executeOktaUpdateGroupOperation } from '@/lib/internal/okta/operations/update-group'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOktaTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'okta_update_group':
      return executeToolOperationImplementation(executeOktaUpdateGroupOperation, request)
    default:
      return Response.json(
        { success: false, error: `Unsupported okta tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
