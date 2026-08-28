import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentListEventsParams,
  ManagedAgentListEventsResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Default cap on how many events land in the workflow output.
 *
 * A long-running agent session accumulates thousands of events, and tool inputs
 * and results can each be large — returning the whole history unbounded would
 * put an unpredictable payload into the workflow. Callers that genuinely need
 * more can raise it.
 */
export const DEFAULT_EVENT_LIMIT = 500

/**
 * Reads a session's event history, oldest first.
 *
 * `assistantText` is precomputed because reading the agent's reply is the
 * overwhelmingly common reason to call this, and doing it correctly is fiddly:
 * only persisted (id-bearing) `agent.message` events count, since stream-only
 * previews are never deduped and would double the text.
 */

export const managedAgentListEventsTool: InternalToolConfig<
  ManagedAgentListEventsParams,
  ManagedAgentListEventsResponse
> = {
  id: 'managed_agent_list_events',
  name: 'Managed Agent List Events',
  description: "Read a Managed Agent session's event history and the agent's reply text.",
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
    eventTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Optional event-type filter, e.g. ['agent.message']. Omit to return every event.",
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      // Written out rather than interpolated: the docs generator extracts this
      // string statically, so a template literal ships as a raw `${...}` to
      // readers. `DEFAULT_EVENT_LIMIT` is asserted against this in tests.
      description: 'Maximum events to return, keeping the most recent (default 500).',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was read.' },
    events: { type: 'json', description: 'Session events, oldest first.' },
    count: { type: 'number', description: 'Number of events returned.' },
    assistantText: {
      type: 'string',
      description: 'Concatenated text of every persisted agent.message, in order.',
    },
    truncated: {
      type: 'boolean',
      description: 'True when the limit was hit and older events were dropped.',
    },
  },
}
