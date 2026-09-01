import { executeUpdateSloOperation } from '@/lib/internal/datadog/operations/update-slo'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeDatadogTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'datadog_update_slo':
      return executeToolOperationImplementation(executeUpdateSloOperation, request)
    default:
      return Response.json(
        { success: false, error: `Unsupported datadog tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
