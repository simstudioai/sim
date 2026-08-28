import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentArchiveSessionParams,
  ManagedAgentArchiveSessionResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Archives a session — it becomes read-only but keeps its full history.
 *
 * This is the cleanup step a long-lived integration needs: without it every
 * run leaves a live session behind in the Claude workspace forever. Archiving
 * is NOT reversible, and a `running` session is rejected — interrupt it first.
 */

export const managedAgentArchiveSessionTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was archived.' },
    archived: { type: 'boolean', description: 'True when the archive was accepted.' },
  },
}
