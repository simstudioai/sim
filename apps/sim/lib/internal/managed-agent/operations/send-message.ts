import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { sendUserMessage } from '@/lib/managed-agents/session-client'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentSendMessageParams,
  ManagedAgentSendMessageResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentSendMessageOperation: InternalToolOperationImplementation<
  ManagedAgentSendMessageParams
> = async (params, signal): Promise<ManagedAgentSendMessageResponse> => {
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: { sessionId: '', sent: false }, error: target.error }
  }

  const text = (params.userMessage ?? '').toString().trim()
  if (!text) {
    return {
      success: false,
      output: { sessionId: target.sessionId, sent: false },
      error: 'A user message is required.',
    }
  }

  try {
    await sendUserMessage({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      text,
      ...(signal ? { signal } : {}),
    })
    return { success: true, output: { sessionId: target.sessionId, sent: true } }
  } catch (error) {
    return {
      success: false,
      output: { sessionId: target.sessionId, sent: false },
      error: getErrorMessage(error, 'Failed to send message to Managed Agent session'),
    }
  }
}
