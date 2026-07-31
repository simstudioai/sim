import { getErrorMessage } from '@sim/utils/errors'
import { sendCustomToolResults } from '@/lib/managed-agents/session-client'
import { isTruthyAck, normalizeStringList } from '@/tools/managed_agent/normalizers'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentCustomToolResultParams,
  ManagedAgentCustomToolResultResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Returns the result of a client-side custom tool the agent invoked.
 *
 * Custom tools run in the caller's application, not Anthropic's sandbox, so the
 * agent parks on `agent.custom_tool_use` until the caller supplies the output.
 * A permission confirmation does NOT unblock these — that is a different event
 * for a different kind of gate. `managed_agent_get_session` labels each pending
 * gate with `kind`, so a workflow can route to the right operation.
 */
export const managedAgentRespondCustomToolTool: ToolConfig<
  ManagedAgentCustomToolResultParams,
  ManagedAgentCustomToolResultResponse
> = {
  id: 'managed_agent_respond_custom_tool',
  name: 'Managed Agent Respond To Custom Tool',
  description:
    'Return the result of a custom tool a Managed Agent session is waiting on so it can continue.',
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
    customToolUseIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Custom tool-use EVENT ids, from Get Session pendingTools[].id where kind is 'custom_tool_result'.",
    },
    result: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The tool's output, returned to the agent as text.",
    },
    isError: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark the result as a failure so the agent can adjust its approach.',
    },
  },

  request: UNUSED_REQUEST,

  directExecution: async (params, signal): Promise<ManagedAgentCustomToolResultResponse> => {
    const emptyOutput = { sessionId: '', answeredToolUseIds: [] as string[] }
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: emptyOutput, error: target.error }
    }

    const customToolUseIds = normalizeStringList(params.customToolUseIds)
    if (customToolUseIds.length === 0) {
      return {
        success: false,
        output: { ...emptyOutput, sessionId: target.sessionId },
        error:
          'At least one custom tool-use event id is required. Read them from Get Session pendingTools[].id.',
      }
    }

    // The result may legitimately be empty (a tool that returns nothing), so
    // only the id list is required — an absent result is sent as an empty string.
    const result = (params.result ?? '').toString()
    const isError = isTruthyAck(params.isError)

    try {
      await sendCustomToolResults({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        results: customToolUseIds.map((customToolUseId) => ({
          customToolUseId,
          content: result,
          isError,
        })),
        ...(signal ? { signal } : {}),
      })
      return {
        success: true,
        output: { sessionId: target.sessionId, answeredToolUseIds: customToolUseIds },
      }
    } catch (error) {
      return {
        success: false,
        output: { ...emptyOutput, sessionId: target.sessionId },
        error: getErrorMessage(error, 'Failed to send custom tool result'),
      }
    }
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was answered.' },
    answeredToolUseIds: {
      type: 'json',
      description: 'The custom tool-use event ids that were answered.',
    },
  },
}
