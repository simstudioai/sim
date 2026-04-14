import { createLogger } from '@sim/logger'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamEvent, StreamingContext } from '@/lib/copilot/request/types'
import { handleCompleteEvent } from './complete'
import { handleErrorEvent } from './error'
import { handleResourceEvent } from './resource'
import { handleRunEvent } from './run'
import { handleSessionEvent } from './session'
import { handleSpanEvent } from './span'
import { handleTextEvent } from './text'
import { handleToolEvent } from './tool'
import type { StreamHandler } from './types'

export type { StreamHandler, ToolScope } from './types'

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
}

export const subAgentHandlers: Record<string, StreamHandler> = {
  [MothershipStreamV1EventType.text]: handleTextEvent('subagent'),
  [MothershipStreamV1EventType.tool]: (e, c, ec, o) => handleToolEvent(e, c, ec, o, 'subagent'),
  [MothershipStreamV1EventType.span]: handleSpanEvent,
}

export function handleSubagentRouting(event: StreamEvent, context: StreamingContext): boolean {
  if (event.scope?.lane !== 'subagent') return false

  // Keep the latest scoped parent on hand for legacy callers, but subagent
  // handlers should prefer the event-local scope for correctness.
  if (event.scope?.parentToolCallId) {
    context.subAgentParentToolCallId = event.scope.parentToolCallId
  }

  if (!context.subAgentParentToolCallId) {
    logger.warn('Subagent event missing parent tool call', {
      type: event.type,
      subagent: event.scope?.agentId,
    })
    return false
  }
  return true
}
