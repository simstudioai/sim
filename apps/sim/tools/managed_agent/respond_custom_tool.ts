import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentCustomToolResultParams,
  ManagedAgentCustomToolResultResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

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

export const managedAgentRespondCustomToolTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
    modelInput: {
      mode: 'project',
      select: (params) => ({ result: params.result }),
    },
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was answered.' },
    answeredToolUseId: {
      type: 'string',
      description: 'The custom tool-use event id that was answered.',
    },
  },
}
