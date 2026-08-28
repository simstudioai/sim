import {
  executeManagedAgentArchiveSessionOperation,
  executeManagedAgentCreateSessionOperation,
  executeManagedAgentDeleteSessionOperation,
  executeManagedAgentGetSessionOperation,
  executeManagedAgentInterruptSessionOperation,
  executeManagedAgentListEventsOperation,
  executeManagedAgentRespondCustomToolOperation,
  executeManagedAgentRespondToolConfirmationOperation,
  executeManagedAgentRunSessionOperation,
  executeManagedAgentSendMessageOperation,
  executeManagedAgentUpdateSessionOperation,
} from '@/lib/internal/managed-agent/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeManagedAgentTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'managed_agent_archive_session':
      return executeToolOperationImplementation(executeManagedAgentArchiveSessionOperation, request)
    case 'managed_agent_create_session':
      return executeToolOperationImplementation(executeManagedAgentCreateSessionOperation, request)
    case 'managed_agent_delete_session':
      return executeToolOperationImplementation(executeManagedAgentDeleteSessionOperation, request)
    case 'managed_agent_get_session':
      return executeToolOperationImplementation(executeManagedAgentGetSessionOperation, request)
    case 'managed_agent_interrupt_session':
      return executeToolOperationImplementation(
        executeManagedAgentInterruptSessionOperation,
        request
      )
    case 'managed_agent_list_events':
      return executeToolOperationImplementation(executeManagedAgentListEventsOperation, request)
    case 'managed_agent_respond_custom_tool':
      return executeToolOperationImplementation(
        executeManagedAgentRespondCustomToolOperation,
        request
      )
    case 'managed_agent_respond_tool_confirmation':
      return executeToolOperationImplementation(
        executeManagedAgentRespondToolConfirmationOperation,
        request
      )
    case 'managed_agent_run_session':
      return executeToolOperationImplementation(executeManagedAgentRunSessionOperation, request)
    case 'managed_agent_send_message':
      return executeToolOperationImplementation(executeManagedAgentSendMessageOperation, request)
    case 'managed_agent_update_session':
      return executeToolOperationImplementation(executeManagedAgentUpdateSessionOperation, request)
    default:
      return Response.json(
        { success: false, error: `Unsupported managed-agent tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
