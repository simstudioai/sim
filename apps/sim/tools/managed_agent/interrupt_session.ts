import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentInterruptSessionParams,
  ManagedAgentInterruptSessionResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Upper bound on the interrupt request itself. Interrupting is the prerequisite
 * for archiving or deleting a running session, so it must fail fast and visibly
 * rather than hang on a stalled connection.
 */
export const INTERRUPT_TIMEOUT_MS = 15_000

/**
 * Stops a running session at its next safe boundary.
 *
 * The interrupt jumps ahead of any queued user events, and the session stays
 * usable afterwards — send another message to carry on. This is also the
 * prerequisite for archiving or deleting a session that is still `running`,
 * since both of those reject a running session.
 */

export const managedAgentInterruptSessionTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was interrupted.' },
    interrupted: { type: 'boolean', description: 'True when the interrupt was accepted.' },
  },
}
