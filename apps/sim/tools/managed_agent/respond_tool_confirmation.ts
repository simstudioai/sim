import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentToolConfirmationParams,
  ManagedAgentToolConfirmationResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

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

export const managedAgentRespondToolConfirmationTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
    modelInput: {
      mode: 'project',
      select: (params) =>
        params.decision?.toString().trim().toLowerCase() === 'deny'
          ? { denyMessage: params.denyMessage }
          : {},
    },
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
