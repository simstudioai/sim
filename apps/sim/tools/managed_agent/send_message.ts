import { getErrorMessage } from '@sim/utils/errors'
import { sendUserMessage } from '@/lib/managed-agents/session-client'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentSendMessageParams,
  ManagedAgentSendMessageResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Sends a user turn into an EXISTING Managed Agent session and returns as soon
 * as the event is accepted.
 *
 * This is what makes a session multi-turn across workflow runs: the session id
 * comes from the caller (a thread lookup, a webhook payload, a prior
 * `managed_agent_create_session`), so a conversation can span many executions
 * instead of being trapped inside one blocking block.
 *
 * Events are queued server-side and processed in order, so there is no need to
 * wait for the agent to go idle before sending the next one.
 */
export const managedAgentSendMessageTool: ToolConfig<
  ManagedAgentSendMessageParams,
  ManagedAgentSendMessageResponse
> = {
  id: 'managed_agent_send_message',
  name: 'Managed Agent Send Message',
  description: 'Send a user message to an existing Claude Platform Managed Agent session.',
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
    userMessage: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user message to send to the session.',
    },
  },

  request: {
    ...UNUSED_REQUEST,
    modelInput: {
      mode: 'project',
      select: (params) => ({ userMessage: params.userMessage }),
    },
  },

  directExecution: async (params, signal): Promise<ManagedAgentSendMessageResponse> => {
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: { sessionId: '', sent: false }, error: target.error }
    }

    const text = (params.userMessage ?? '').toString().trim()
    if (!text) {
      return {
        success: false,
        output: { sessionId: target.sessionId, sent: false },
        error: 'A user message is required.',
      }
    }

    try {
      await sendUserMessage({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        text,
        ...(signal ? { signal } : {}),
      })
      return { success: true, output: { sessionId: target.sessionId, sent: true } }
    } catch (error) {
      return {
        success: false,
        output: { sessionId: target.sessionId, sent: false },
        error: getErrorMessage(error, 'Failed to send message to Managed Agent session'),
      }
    }
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session the message was sent to.' },
    sent: { type: 'boolean', description: 'True when the event was accepted by the API.' },
  },
}
