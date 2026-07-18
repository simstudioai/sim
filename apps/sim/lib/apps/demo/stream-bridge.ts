import { generateId } from '@sim/utils/id'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamEvent } from '@/lib/copilot/request/types'

const BACKEND_AGENT_ID = 'fullstack_backend'
const MAIN_SPAN_ID = 'main'

export class FullstackWorkerStreamBridge {
  private readonly spanId = `fullstack-backend:${generateId()}`
  private opened = false
  private closed = false

  constructor(private readonly publish: (event: StreamEvent) => void | Promise<void>) {}

  async forward(event: StreamEvent): Promise<void> {
    if (
      event.type !== MothershipStreamV1EventType.tool &&
      event.type !== MothershipStreamV1EventType.resource &&
      event.type !== MothershipStreamV1EventType.span
    ) {
      return
    }

    await this.open()

    if (event.type === MothershipStreamV1EventType.span) {
      const nestedSpanId = event.scope?.spanId
      if (!nestedSpanId) return
      await this.publish({
        ...event,
        scope: {
          lane: 'subagent',
          agentId: event.scope?.agentId ?? BACKEND_AGENT_ID,
          spanId: nestedSpanId,
          parentSpanId: this.spanId,
          ...(event.scope?.parentToolCallId
            ? { parentToolCallId: event.scope.parentToolCallId }
            : {}),
        },
      })
      return
    }

    await this.publish({
      ...event,
      scope: {
        lane: 'subagent',
        agentId: BACKEND_AGENT_ID,
        spanId: this.spanId,
        parentSpanId: MAIN_SPAN_ID,
        ...(event.scope?.parentToolCallId
          ? { parentToolCallId: event.scope.parentToolCallId }
          : {}),
      },
    })
  }

  async close(params: { error?: string; cancelled?: boolean } = {}): Promise<void> {
    if (!this.opened || this.closed) return
    this.closed = true
    await this.publish({
      type: MothershipStreamV1EventType.span,
      scope: {
        lane: 'subagent',
        agentId: BACKEND_AGENT_ID,
        spanId: this.spanId,
        parentSpanId: MAIN_SPAN_ID,
      },
      payload: {
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        event: MothershipStreamV1SpanLifecycleEvent.end,
        agent: BACKEND_AGENT_ID,
        data: {
          ...(params.error ? { error: params.error } : {}),
          ...(params.cancelled ? { cancelled: true } : {}),
        },
      },
    })
  }

  get persistenceSpanId(): string {
    return this.spanId
  }

  private async open(): Promise<void> {
    if (this.opened) return
    this.opened = true
    await this.publish({
      type: MothershipStreamV1EventType.span,
      scope: {
        lane: 'subagent',
        agentId: BACKEND_AGENT_ID,
        spanId: this.spanId,
        parentSpanId: MAIN_SPAN_ID,
      },
      payload: {
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        event: MothershipStreamV1SpanLifecycleEvent.start,
        agent: BACKEND_AGENT_ID,
      },
    })
  }
}

export const FULLSTACK_BACKEND_AGENT_ID = BACKEND_AGENT_ID
