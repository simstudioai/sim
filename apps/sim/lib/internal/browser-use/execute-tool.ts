import { executeRunTaskOperation } from '@/lib/internal/browser-use/operations/run-task'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeBrowserUseTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'browser_use_run_task':
      return executeToolOperationImplementation(executeRunTaskOperation, request)
    default:
      return Response.json(
        { success: false, error: `Unsupported browser-use tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
