import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { sendSessionEvents } from '@/lib/managed-agents/session-client'
import { INTERRUPT_TIMEOUT_MS } from '@/tools/managed_agent/interrupt_session'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentInterruptSessionParams,
  ManagedAgentInterruptSessionResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentInterruptSessionOperation: InternalToolOperationImplementation<
  ManagedAgentInterruptSessionParams
> = async (params, signal): Promise<ManagedAgentInterruptSessionResponse> => {
  const target = resolveSessionTarget(params)
  if (!target.ok) {
    return { success: false, output: { sessionId: '', interrupted: false }, error: target.error }
  }

  try {
    await sendSessionEvents({
      apiKey: target.apiKey,
      sessionId: target.sessionId,
      events: [{ type: 'user.interrupt' }],
      // Bounded so a stalled connection can't hang the operation. The
      // workflow's own signal still cancels earlier when present; `any`
      // resolves on whichever fires first.
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(INTERRUPT_TIMEOUT_MS)])
        : AbortSignal.timeout(INTERRUPT_TIMEOUT_MS),
    })
    return { success: true, output: { sessionId: target.sessionId, interrupted: true } }
  } catch (error) {
    return {
      success: false,
      output: { sessionId: target.sessionId, interrupted: false },
      error: getErrorMessage(error, 'Failed to interrupt Managed Agent session'),
    }
  }
}
