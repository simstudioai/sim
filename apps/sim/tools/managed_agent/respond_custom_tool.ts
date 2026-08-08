import { getErrorMessage } from '@sim/utils/errors'
import { sendCustomToolResults } from '@/lib/managed-agents/session-client'
import { isTruthyAck } from '@/tools/managed_agent/normalizers'
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
 *
 * Deliberately answers ONE call per invocation. Each pending custom tool has
 * its own output, so accepting a list here would force every one of them to
 * share a single result — silently wrong whenever more than one is pending.
 * Answer several by iterating this operation over `pendingTools`.
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
    customToolUseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "The custom tool-use EVENT id being answered, from Get Session pendingTools[].id where kind is 'custom_tool_result'.",
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

  request: {
    ...UNUSED_REQUEST,
    modelInput: {
      mode: 'project',
      select: (params) => ({ result: params.result }),
    },
  },

  directExecution: async (params, signal): Promise<ManagedAgentCustomToolResultResponse> => {
    const emptyOutput = { sessionId: '', answeredToolUseId: '' }
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: emptyOutput, error: target.error }
    }

    const customToolUseId = params.customToolUseId?.trim()
    if (!customToolUseId) {
      return {
        success: false,
        output: { ...emptyOutput, sessionId: target.sessionId },
        error:
          'A custom tool-use event id is required. Read it from Get Session pendingTools[].id.',
      }
    }

    // The result may legitimately be empty (a tool that returns nothing), so
    // only the id is required — an absent result is sent as an empty string.
    const result = (params.result ?? '').toString()
    const isError = isTruthyAck(params.isError)

    try {
      await sendCustomToolResults({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        results: [{ customToolUseId, content: result, isError }],
        ...(signal ? { signal } : {}),
      })
      return {
        success: true,
        output: { sessionId: target.sessionId, answeredToolUseId: customToolUseId },
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
    answeredToolUseId: {
      type: 'string',
      description: 'The custom tool-use event id that was answered.',
    },
  },
}
