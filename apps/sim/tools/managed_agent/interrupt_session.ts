import { getErrorMessage } from '@sim/utils/errors'
import { sendSessionEvents } from '@/lib/managed-agents/session-client'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentInterruptSessionParams,
  ManagedAgentInterruptSessionResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Upper bound on the interrupt request itself. Interrupting is the prerequisite
 * for archiving or deleting a running session, so it must fail fast and visibly
 * rather than hang on a stalled connection.
 */
const INTERRUPT_TIMEOUT_MS = 15_000

/**
 * Stops a running session at its next safe boundary.
 *
 * The interrupt jumps ahead of any queued user events, and the session stays
 * usable afterwards — send another message to carry on. This is also the
 * prerequisite for archiving or deleting a session that is still `running`,
 * since both of those reject a running session.
 */
export const managedAgentInterruptSessionTool: ToolConfig<
  ManagedAgentInterruptSessionParams,
  ManagedAgentInterruptSessionResponse
> = {
  id: 'managed_agent_interrupt_session',
  name: 'Managed Agent Interrupt Session',
  description: 'Stop a running Managed Agent session; it stays usable afterwards.',
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
  },

  request: UNUSED_REQUEST,

  directExecution: async (params, signal): Promise<ManagedAgentInterruptSessionResponse> => {
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
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was interrupted.' },
    interrupted: { type: 'boolean', description: 'True when the interrupt was accepted.' },
  },
}
