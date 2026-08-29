import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { listSessionEventsPage } from '@/lib/managed-agents/session-client'
import { DEFAULT_EVENT_LIMIT } from '@/tools/managed_agent/list_events'
import { normalizeStringList } from '@/tools/managed_agent/normalizers'
import { resolveSessionTarget } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentListEventsParams,
  ManagedAgentListEventsResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentListEventsOperation: InternalToolOperationImplementation<
  ManagedAgentListEventsParams
> = async (params, signal): Promise<ManagedAgentListEventsResponse> => {
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
}
