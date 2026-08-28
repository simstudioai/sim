import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { sendCustomToolResults } from '@/lib/managed-agents/session-client'
import { isTruthyAck } from '@/tools/managed_agent/normalizers'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentCustomToolResultParams,
  ManagedAgentCustomToolResultResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentRespondCustomToolOperation: InternalToolOperationImplementation<
  ManagedAgentCustomToolResultParams
> = async (params, signal): Promise<ManagedAgentCustomToolResultResponse> => {
  const emptyOutput = { sessionId: '', answeredToolUseId: '' }
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: emptyOutput, error: target.error }
  }

  const customToolUseId = params.customToolUseId?.trim()
  if (!customToolUseId) {
    return {
      success: false,
      output: { ...emptyOutput, sessionId: target.sessionId },
      error: 'A custom tool-use event id is required. Read it from Get Session pendingTools[].id.',
    }
  }

  // The result may legitimately be empty (a tool that returns nothing), so
  // only the id is required — an absent result is sent as an empty string.
  const result = (params.result ?? '').toString()
  const isError = isTruthyAck(params.isError)

  try {
    await sendCustomToolResults({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      results: [{ customToolUseId, content: result, isError }],
      ...(signal ? { signal } : {}),
    })
    return {
      success: true,
      output: { sessionId: target.sessionId, answeredToolUseId: customToolUseId },
    }
  } catch (error) {
    return {
      success: false,
      output: { ...emptyOutput, sessionId: target.sessionId },
      error: getErrorMessage(error, 'Failed to send custom tool result'),
    }
  }
}
