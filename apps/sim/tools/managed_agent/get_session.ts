import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentGetSessionParams,
  ManagedAgentGetSessionResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

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

export const managedAgentGetSessionTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
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
