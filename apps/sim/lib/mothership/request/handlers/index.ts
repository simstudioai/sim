import { createLogger } from '@sim/logger'
import { MothershipStreamV1EventType } from '@/lib/mothership/generated/mothership-stream-v1'
import { isSubagentSpanStreamEvent } from '@/lib/mothership/request/session/contract'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'
import { handleCompleteEvent } from './complete'
import { handleErrorEvent } from './error'
import { handlePlanEvent } from './plan'
import { handleResourceEvent } from './resource'
import { handleRunEvent } from './run'
import { handleSessionEvent } from './session'
import { handleSpanEvent } from './span'
import { handleTextEvent } from './text'
import { handleToolEvent, prePersistClientExecutableToolCall } from './tool'
import type { StreamHandler } from './types'

export { prePersistClientExecutableToolCall }
export type { StreamHandler } from './types'

const logger = createLogger('CopilotHandlerRouting')

export const sseHandlers: Record<string, StreamHandler> = {
  [MothershipStreamV1EventType.session]: handleSessionEvent,
  [MothershipStreamV1EventType.tool]: (e, c, ec, o) => handleToolEvent(e, c, ec, o, 'main'),
  [MothershipStreamV1EventType.text]: handleTextEvent('main'),
  [MothershipStreamV1EventType.resource]: handleResourceEvent,
  [MothershipStreamV1EventType.run]: handleRunEvent,
  [MothershipStreamV1EventType.complete]: handleCompleteEvent,
  [MothershipStreamV1EventType.error]: handleErrorEvent,
  [MothershipStreamV1EventType.span]: handleSpanEvent,
  plan: handlePlanEvent,
}

export const subAgentHandlers: Record<string, StreamHandler> = {
  [MothershipStreamV1EventType.text]: handleTextEvent('subagent'),
  [MothershipStreamV1EventType.tool]: (e, c, ec, o) => handleToolEvent(e, c, ec, o, 'subagent'),
  [MothershipStreamV1EventType.run]: handleRunEvent,
  [MothershipStreamV1EventType.span]: handleSpanEvent,
}

/** Live delivery and saved-prefix restoration share lane attribution and receipt advancement. */
export async function applyStreamEvent(
  event: StreamEvent,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions
): Promise<void> {
  if (isSubagentSpanStreamEvent(event)) {
    await sseHandlers.span?.(event, context, execContext, options)
    return
  }
  if (event.scope?.lane === 'subagent') {
    if (handleSubagentRouting(event, context)) {
      await subAgentHandlers[event.type]?.(event, context, execContext, options)
    }
    return
  }
  await sseHandlers[event.type]?.(event, context, execContext, options)
  if (
    event.type === 'complete' ||
    (event.type === 'run' && event.payload.kind === 'checkpoint_pause')
  ) {
    /** Only a handled leg boundary acknowledges its preceding activity. */
    if (event.payload.activityReceipt) context.receivedActivity = event.payload.activityReceipt
  }
}

export function handleSubagentRouting(event: StreamEvent, _context: StreamingContext): boolean {
  if (event.scope?.lane !== 'subagent') return false

  // Scope-only attribution: a subagent event MUST carry its own parentToolCallId.
  // With concurrent subagents there is no single "current" lane to fall back to —
  // routing by a global pointer would mis-attribute interleaved events to the
  // last-started subagent. A missing parentToolCallId is a contract violation
  // (Go always stamps it), so warn and route to the main lane rather than guess.
  if (!event.scope?.parentToolCallId) {
    logger.warn('Subagent event missing parent tool call id; routing to main lane', {
      type: event.type,
      subagent: event.scope?.agentId,
    })
    return false
  }
  return true
}
