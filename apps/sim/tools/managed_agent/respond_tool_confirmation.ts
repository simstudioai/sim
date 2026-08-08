import { getErrorMessage } from '@sim/utils/errors'
import { sendToolConfirmations } from '@/lib/managed-agents/session-client'
import { normalizeStringList } from '@/tools/managed_agent/normalizers'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentToolConfirmationParams,
  ManagedAgentToolConfirmationResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Answers the `always_ask` permission gates blocking a session.
 *
 * Without this, an agent configured with an `always_ask` policy on any tool
 * parks forever: it emits `agent.tool_use`, the session idles with
 * `stop_reason.type === 'requires_action'`, and it waits indefinitely for a
 * `user.tool_confirmation`. Pair with `managed_agent_get_session`, which
 * surfaces the blocking ids in `pendingTools`.
 *
 * All ids are answered in a single request: resolving only some of a turn's
 * gates leaves the session parked on the rest.
 */
export const managedAgentRespondToolConfirmationTool: ToolConfig<
  ManagedAgentToolConfirmationParams,
  ManagedAgentToolConfirmationResponse
> = {
  id: 'managed_agent_respond_tool_confirmation',
  name: 'Managed Agent Respond To Tool Confirmation',
  description:
    'Allow or deny the tool calls a Managed Agent session is waiting on before it can continue.',
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
    toolUseIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Blocking tool-use EVENT ids, from Get Session pendingTools[].id where kind is 'confirmation' (not toolu_ ids).",
    },
    decision: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "'allow' to let the tools run, or 'deny' to reject them.",
    },
    denyMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason surfaced to the agent. Only sent when the decision is deny.',
    },
  },

  request: {
    ...UNUSED_REQUEST,
    modelInput: {
      mode: 'project',
      select: (params) =>
        params.decision?.toString().trim().toLowerCase() === 'deny'
          ? { denyMessage: params.denyMessage }
          : {},
    },
  },

  directExecution: async (params, signal): Promise<ManagedAgentToolConfirmationResponse> => {
    const emptyOutput = { sessionId: '', decision: '', confirmedToolUseIds: [] as string[] }
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: emptyOutput, error: target.error }
    }

    const decision = (params.decision ?? '').toString().trim().toLowerCase()
    if (decision !== 'allow' && decision !== 'deny') {
      return {
        success: false,
        output: { ...emptyOutput, sessionId: target.sessionId },
        error: "Decision must be 'allow' or 'deny'.",
      }
    }

    const toolUseIds = normalizeStringList(params.toolUseIds)
    if (toolUseIds.length === 0) {
      return {
        success: false,
        output: { ...emptyOutput, sessionId: target.sessionId, decision },
        error:
          'At least one tool-use event id is required. Read them from Get Session pendingTools[].id.',
      }
    }

    const denyMessage = params.denyMessage?.trim()
    try {
      await sendToolConfirmations({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        confirmations: toolUseIds.map((toolUseId) => ({
          toolUseId,
          result: decision,
          ...(decision === 'deny' && denyMessage ? { denyMessage } : {}),
        })),
        ...(signal ? { signal } : {}),
      })
      return {
        success: true,
        output: { sessionId: target.sessionId, decision, confirmedToolUseIds: toolUseIds },
      }
    } catch (error) {
      return {
        success: false,
        output: { sessionId: target.sessionId, decision, confirmedToolUseIds: [] },
        error: getErrorMessage(error, 'Failed to send tool confirmation'),
      }
    }
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was answered.' },
    decision: { type: 'string', description: "The decision applied — 'allow' or 'deny'." },
    confirmedToolUseIds: {
      type: 'json',
      description: 'The tool-use event ids that were answered.',
    },
  },
}
