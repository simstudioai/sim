import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { resolvePendingToolGates, retrieveSession } from '@/lib/managed-agents/session-client'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentGetSessionParams,
  ManagedAgentGetSessionResponse,
  ManagedAgentPendingTool,
} from '@/tools/managed_agent/types'

const logger = createLogger('ManagedAgentGetSession')
const REQUIRES_ACTION = 'requires_action'

export const executeManagedAgentGetSessionOperation: InternalToolOperationImplementation<
  ManagedAgentGetSessionParams
> = async (params, signal): Promise<ManagedAgentGetSessionResponse> => {
  const emptyOutput = {
    sessionId: '',
    status: '',
    requiresAction: false,
    pendingTools: [] as ManagedAgentPendingTool[],
  }
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: emptyOutput, error: target.error }
  }

  try {
    const snapshot = await retrieveSession({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      ...(signal ? { signal } : {}),
    })

    const requiresAction =
      snapshot.status === 'idle' && snapshot.stopReason?.type === REQUIRES_ACTION
    const eventIds = snapshot.stopReason?.eventIds ?? []
    // Only pay for the events call when the session is actually blocked.
    const pendingTools =
      requiresAction && eventIds.length > 0
        ? await resolvePendingToolGates({
            apiKey: target.apiKey,
            sessionId: target.sessionId,
            eventIds,
            ...(signal ? { signal } : {}),
          })
        : []

    // A blocked session that names no blocking events is an anomaly: it waits
    // indefinitely, but nothing here can say for what. `requiresAction` stays
    // true because that is the truth — reporting false would tell a workflow
    // the session is fine while it is parked forever — so log it instead, so
    // the dead end is visible rather than silent.
    if (requiresAction && pendingTools.length === 0) {
      logger.warn('Managed Agent session requires action but reported no blocking event ids', {
        sessionId: target.sessionId,
      })
    }

    return {
      success: true,
      output: {
        sessionId: target.sessionId,
        status: snapshot.status ?? '',
        ...(snapshot.stopReason?.type ? { stopReason: snapshot.stopReason.type } : {}),
        requiresAction,
        pendingTools,
        ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
        ...(snapshot.title ? { title: snapshot.title } : {}),
        ...(snapshot.usage?.inputTokens !== undefined
          ? { inputTokens: snapshot.usage.inputTokens }
          : {}),
        ...(snapshot.usage?.outputTokens !== undefined
          ? { outputTokens: snapshot.usage.outputTokens }
          : {}),
      },
    }
  } catch (error) {
    return {
      success: false,
      output: { ...emptyOutput, sessionId: target.sessionId },
      error: getErrorMessage(error, 'Failed to read Managed Agent session'),
    }
  }
}
