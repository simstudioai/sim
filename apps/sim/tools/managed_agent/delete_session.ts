import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentDeleteSessionParams,
  ManagedAgentDeleteSessionResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Permanently deletes a session, its event history, and its sandbox.
 *
 * Files, memory stores, vaults, skills, environments, and agents are separate
 * resources and are NOT affected. A `running` session is rejected — interrupt
 * it first. Prefer archiving when the transcript still has value; this is the
 * right choice when the session held sensitive input that should not persist.
 */

export const managedAgentDeleteSessionTool: InternalToolConfig<
  ManagedAgentDeleteSessionParams,
  ManagedAgentDeleteSessionResponse
> = {
  id: 'managed_agent_delete_session',
  name: 'Managed Agent Delete Session',
  description:
    'Permanently delete a Managed Agent session, its events, and its sandbox. Not reversible.',
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
    sessionId: { type: 'string', description: 'The session that was deleted.' },
    deleted: { type: 'boolean', description: 'True when the delete was accepted.' },
  },
}
