import { reconcileTextEvent } from '@/lib/mothership/request/go/text-receipt'
import type { StreamEvent } from '@/lib/mothership/request/types'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'

/** Projects only the main agent's public lifecycle; payloads never cross this delivery boundary. */
export class ExecuteEventProjection {
  private lastSeq = -1
  private receivedText = ''
  private finished = false
  private readonly seenTools = new Set<string>()
  private readonly tools = new Map<string, { name: string; ended: boolean }>()

  constructor(private readonly send: (event: AgentStreamEvent) => void) {}

  accept(event: StreamEvent): void {
    if (this.finished) return
    if (event.seq !== undefined) {
      if (event.seq <= this.lastSeq) return
      this.lastSeq = event.seq
    }
    if (event.scope?.lane === 'subagent') return
    const reconciled = reconcileTextEvent(event, this.receivedText)
    if (!reconciled) return
    if (reconciled.type === 'text') {
      if (reconciled.payload.channel === 'assistant') {
        this.receivedText += reconciled.payload.text
        this.send({ type: 'text_delta', text: reconciled.payload.text, turn: 'pending' })
      } else {
        this.send({ type: 'thinking_delta', text: reconciled.payload.text })
      }
      return
    }
    if (event.type !== 'tool' || !('phase' in event.payload)) return
    const tool = event.payload
    if (tool.phase === 'call') {
      if (this.seenTools.has(tool.toolCallId)) return
      this.seenTools.add(tool.toolCallId)
      if (!tool.replay) this.send({ type: 'turn_end', turn: 'intermediate' })
      if (tool.ui?.hidden || tool.ui?.internal) return
      this.tools.set(tool.toolCallId, { name: tool.toolName, ended: false })
      this.send({ type: 'tool_call_start', id: tool.toolCallId, name: tool.toolName })
    } else if (tool.phase === 'result') {
      this.endTool(
        tool.toolCallId,
        tool.status === 'cancelled' ? 'cancelled' : tool.success ? 'success' : 'error'
      )
    }
  }

  private endTool(id: string, status: ToolCallEndStatus): void {
    const tool = this.tools.get(id)
    if (!tool || tool.ended) return
    tool.ended = true
    this.send({ type: 'tool_call_end', id, name: tool.name, status })
  }

  finish(status: ToolCallEndStatus): void {
    if (this.finished) return
    this.finished = true
    for (const id of this.tools.keys()) this.endTool(id, status === 'success' ? 'error' : status)
    if (status === 'success') this.send({ type: 'turn_end', turn: 'final' })
  }
}
