import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { resolvePendingToolGates, retrieveSession } from '@/lib/managed-agents/session-client'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentGetSessionParams,
  ManagedAgentGetSessionResponse,
  ManagedAgentPendingTool,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ManagedAgentGetSession')

/** `stop_reason.type` meaning the session is parked awaiting a client response. */
const REQUIRES_ACTION = 'requires_action'

/**
 * Reads a Managed Agent session's current state, and — when it is blocked on an
 * `always_ask` permission gate — resolves the blocking tool calls to their
 * names and inputs.
 *
 * That enrichment is the point of this tool. A session that stops with
 * `stop_reason.type === 'requires_action'` waits INDEFINITELY for a
 * `user.tool_confirmation`, so a workflow that cannot see which tools are
 * pending has no way to build an approval prompt and the session hangs. The
 * blocking event ids come straight from `stop_reason.event_ids`; the tool
 * names are cross-referenced from the session's tool-use events.
 */
export const managedAgentGetSessionTool: ToolConfig<
  ManagedAgentGetSessionParams,
  ManagedAgentGetSessionResponse
> = {
  id: 'managed_agent_get_session',
  name: 'Managed Agent Get Session',
  description:
    'Read a Managed Agent session: status, stop reason, token usage, metadata, and any tool calls awaiting approval.',
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
  },

  request: UNUSED_REQUEST,

  directExecution: async (params, signal): Promise<ManagedAgentGetSessionResponse> => {
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

      const requiresAction = snapshot.stopReason?.type === REQUIRES_ACTION
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
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was read.' },
    status: {
      type: 'string',
      description: "Session status — 'idle', 'running', 'rescheduling', or 'terminated'.",
    },
    stopReason: {
      type: 'string',
      description: "Why the session last stopped, e.g. 'end_turn' or 'requires_action'.",
      optional: true,
    },
    requiresAction: {
      type: 'boolean',
      description:
        'True when the session is waiting on a tool confirmation or custom tool result. If this is true while pendingTools is empty, the session is blocked but the API named no blocking events — surface it rather than treating the session as done.',
    },
    pendingTools: {
      type: 'json',
      description:
        "Blocking tool calls — [{id, eventType, kind, name, input}]. Route by kind: 'confirmation' ids go to Respond To Tool Confirmation, 'custom_tool_result' ids go to Respond To Custom Tool.",
    },
    metadata: { type: 'json', description: 'Session metadata.', optional: true },
    title: { type: 'string', description: 'Session title.', optional: true },
    inputTokens: {
      type: 'number',
      description: 'Cumulative input tokens.',
      optional: true,
    },
    outputTokens: {
      type: 'number',
      description: 'Cumulative output tokens.',
      optional: true,
    },
  },
}
