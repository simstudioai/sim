import { getErrorMessage } from '@sim/utils/errors'
import { archiveSession } from '@/lib/managed-agents/session-client'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentArchiveSessionParams,
  ManagedAgentArchiveSessionResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Archives a session — it becomes read-only but keeps its full history.
 *
 * This is the cleanup step a long-lived integration needs: without it every
 * run leaves a live session behind in the Claude workspace forever. Archiving
 * is NOT reversible, and a `running` session is rejected — interrupt it first.
 */
export const managedAgentArchiveSessionTool: ToolConfig<
  ManagedAgentArchiveSessionParams,
  ManagedAgentArchiveSessionResponse
> = {
  id: 'managed_agent_archive_session',
  name: 'Managed Agent Archive Session',
  description: 'Archive a Managed Agent session, preserving its history. Not reversible.',
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
  },

  request: UNUSED_REQUEST,

  directExecution: async (params, signal): Promise<ManagedAgentArchiveSessionResponse> => {
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: { sessionId: '', archived: false }, error: target.error }
    }

    try {
      await archiveSession({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        ...(signal ? { signal } : {}),
      })
      return { success: true, output: { sessionId: target.sessionId, archived: true } }
    } catch (error) {
      return {
        success: false,
        output: { sessionId: target.sessionId, archived: false },
        error: getErrorMessage(error, 'Failed to archive Managed Agent session'),
      }
    }
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was archived.' },
    archived: { type: 'boolean', description: 'True when the archive was accepted.' },
  },
}
