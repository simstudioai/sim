import { getErrorMessage } from '@sim/utils/errors'
import { listSessionEventsPage } from '@/lib/managed-agents/session-client'
import { normalizeStringList } from '@/tools/managed_agent/normalizers'
import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  resolveSessionTarget,
  SESSION_ID_PARAM,
  UNUSED_REQUEST,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentListEventsParams,
  ManagedAgentListEventsResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Default cap on how many events land in the workflow output.
 *
 * A long-running agent session accumulates thousands of events, and tool inputs
 * and results can each be large — returning the whole history unbounded would
 * put an unpredictable payload into the workflow. Callers that genuinely need
 * more can raise it.
 */
const DEFAULT_EVENT_LIMIT = 500

/**
 * Reads a session's event history, oldest first.
 *
 * `assistantText` is precomputed because reading the agent's reply is the
 * overwhelmingly common reason to call this, and doing it correctly is fiddly:
 * only persisted (id-bearing) `agent.message` events count, since stream-only
 * previews are never deduped and would double the text.
 */
export const managedAgentListEventsTool: ToolConfig<
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

  request: UNUSED_REQUEST,

  directExecution: async (params, signal): Promise<ManagedAgentListEventsResponse> => {
    const emptyOutput = {
      sessionId: '',
      events: [] as unknown[],
      count: 0,
      assistantText: '',
      truncated: false,
    }
    const target = resolveSessionTarget(params)
    if (!target.ok) {
      return { success: false, output: emptyOutput, error: target.error }
    }

    const types = normalizeStringList(params.eventTypes)
    // Floor BEFORE the positivity check: a fractional limit like 0.5 would pass
    // `> 0` and then floor to 0, which reads as "no cap" downstream and returns
    // the whole history. Anything that does not floor to a positive integer
    // falls back to the default rather than silently becoming unbounded.
    const requested = Math.floor(Number(params.limit))
    const maxItems = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_EVENT_LIMIT

    try {
      const { events, total } = await listSessionEventsPage({
        apiKey: target.apiKey,
        sessionId: target.sessionId,
        maxItems,
        ...(types.length > 0 ? { types } : {}),
        ...(signal ? { signal } : {}),
      })

      let assistantText = ''
      for (const event of events) {
        // Skip idless events: those are stream-only previews, and the persisted
        // copy carrying the same text arrives separately.
        if (event.type !== 'agent.message' || !event.id || !Array.isArray(event.content)) continue
        for (const block of event.content) {
          if (block?.type === 'text' && typeof block.text === 'string') assistantText += block.text
        }
      }

      return {
        success: true,
        output: {
          sessionId: target.sessionId,
          events,
          count: events.length,
          assistantText,
          // Compared against the untrimmed history size, not the limit: a
          // session holding exactly `maxItems` events dropped nothing and must
          // not be reported as a partial read.
          truncated: total > events.length,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: { ...emptyOutput, sessionId: target.sessionId },
        error: getErrorMessage(error, 'Failed to list Managed Agent session events'),
      }
    }
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
