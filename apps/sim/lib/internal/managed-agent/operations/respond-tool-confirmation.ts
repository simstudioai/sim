import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { sendToolConfirmations } from '@/lib/managed-agents/session-client'
import { normalizeStringList } from '@/tools/managed_agent/normalizers'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentToolConfirmationParams,
  ManagedAgentToolConfirmationResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentRespondToolConfirmationOperation: InternalToolOperationImplementation<
  ManagedAgentToolConfirmationParams
> = async (params, signal): Promise<ManagedAgentToolConfirmationResponse> => {
  const emptyOutput = { sessionId: '', decision: '', confirmedToolUseIds: [] as string[] }
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: emptyOutput, error: target.error }
  }

  const decision = (params.decision ?? '').toString().trim().toLowerCase()
  if (decision !== 'allow' && decision !== 'deny') {
    return {
      success: false,
      output: { ...emptyOutput, sessionId: target.sessionId },
      error: "Decision must be 'allow' or 'deny'.",
    }
  }

  const toolUseIds = normalizeStringList(params.toolUseIds)
  if (toolUseIds.length === 0) {
    return {
      success: false,
      output: { ...emptyOutput, sessionId: target.sessionId, decision },
      error:
        'At least one tool-use event id is required. Read them from Get Session pendingTools[].id.',
    }
  }

  const denyMessage = params.denyMessage?.trim()
  try {
    await sendToolConfirmations({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      confirmations: toolUseIds.map((toolUseId) => ({
        toolUseId,
        result: decision,
        ...(decision === 'deny' && denyMessage ? { denyMessage } : {}),
      })),
      ...(signal ? { signal } : {}),
    })
    return {
      success: true,
      output: { sessionId: target.sessionId, decision, confirmedToolUseIds: toolUseIds },
    }
  } catch (error) {
    return {
      success: false,
      output: { sessionId: target.sessionId, decision, confirmedToolUseIds: [] },
      error: getErrorMessage(error, 'Failed to send tool confirmation'),
    }
  }
}
