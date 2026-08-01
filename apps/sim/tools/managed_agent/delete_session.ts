import { getErrorMessage } from '@sim/utils/errors'
import { deleteSession } from '@/lib/managed-agents/session-client'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentDeleteSessionParams,
  ManagedAgentDeleteSessionResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Permanently deletes a session, its event history, and its sandbox.
 *
 * Files, memory stores, vaults, skills, environments, and agents are separate
 * resources and are NOT affected. A `running` session is rejected — interrupt
 * it first. Prefer archiving when the transcript still has value; this is the
 * right choice when the session held sensitive input that should not persist.
 */
export const managedAgentDeleteSessionTool: ToolConfig<
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

  request: UNUSED_REQUEST,

  directExecution: async (params, signal): Promise<ManagedAgentDeleteSessionResponse> => {
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: { sessionId: '', deleted: false }, error: target.error }
    }

    try {
      await deleteSession({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        ...(signal ? { signal } : {}),
      })
      return { success: true, output: { sessionId: target.sessionId, deleted: true } }
    } catch (error) {
      return {
        success: false,
        output: { sessionId: target.sessionId, deleted: false },
        error: getErrorMessage(error, 'Failed to delete Managed Agent session'),
      }
    }
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was deleted.' },
    deleted: { type: 'boolean', description: 'True when the delete was accepted.' },
  },
}
