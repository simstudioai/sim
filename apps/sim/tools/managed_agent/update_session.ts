import { getErrorMessage } from '@sim/utils/errors'
import { updateSession } from '@/lib/managed-agents/session-client'
import { normalizeSessionParameters } from '@/tools/managed_agent/normalizers'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentUpdateSessionParams,
  ManagedAgentUpdateSessionResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Updates an existing session's title and/or metadata.
 *
 * Metadata is settable at create time too, but some of what you want to store
 * only exists AFTER the session does — the canonical case is writing back the
 * id of a message/thread that was posted to announce the session. This closes
 * that ordering gap.
 *
 * Metadata is a FULL REPLACEMENT of the stored map, matching the API. To add
 * one key, read the session first and send the merged map.
 */
export const managedAgentUpdateSessionTool: ToolConfig<
  ManagedAgentUpdateSessionParams,
  ManagedAgentUpdateSessionResponse
> = {
  id: 'managed_agent_update_session',
  name: 'Managed Agent Update Session',
  description: "Update a Managed Agent session's title or metadata.",
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New session title.',
    },
    sessionParameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement metadata map (replaces all stored metadata, not merged).',
    },
  },

  request: UNUSED_REQUEST,

  directExecution: async (params, signal): Promise<ManagedAgentUpdateSessionResponse> => {
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: { sessionId: '', updated: false }, error: target.error }
    }

    const title = params.title?.trim()
    const metadata = normalizeSessionParameters(params.sessionParameters)
    if (title === undefined && metadata === undefined) {
      return {
        success: false,
        output: { sessionId: target.sessionId, updated: false },
        error: 'Provide a title or metadata to update.',
      }
    }

    try {
      const snapshot = await updateSession({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        ...(title !== undefined ? { title } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        ...(signal ? { signal } : {}),
      })
      return {
        success: true,
        output: {
          sessionId: target.sessionId,
          updated: true,
          ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
          ...(snapshot.title ? { title: snapshot.title } : {}),
        },
      }
    } catch (error) {
      return {
        success: false,
        output: { sessionId: target.sessionId, updated: false },
        error: getErrorMessage(error, 'Failed to update Managed Agent session'),
      }
    }
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was updated.' },
    updated: { type: 'boolean', description: 'True when the update was accepted.' },
    metadata: { type: 'json', description: 'Metadata after the update.', optional: true },
    title: { type: 'string', description: 'Title after the update.', optional: true },
  },
}
