import { MothershipStreamV1TextChannel } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type {
  StreamEventScope,
  StreamLoopContext,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type TextEvent = Extract<PersistedStreamEventEnvelope, { type: 'text' }>

export function handleTextEvent(
  ctx: StreamLoopContext,
  parsed: TextEvent,
  scope: StreamEventScope
): void {
  const { state, ops, deps } = ctx
  const { scopedSubagent, scopedParentToolCallId, spanIdentity } = scope

  const chunk = parsed.payload.text
  if (!chunk) return

  const eventTs = typeof parsed.ts === 'string' ? parsed.ts : undefined

  if (parsed.payload.channel === MothershipStreamV1TextChannel.thinking) {
    const scopedParentForBlock = ops.resolveParentForSubagentBlock(
      scopedSubagent,
      scopedParentToolCallId
    )
    const tb = ops.ensureThinkingBlock(scopedSubagent, scopedParentForBlock, eventTs, spanIdentity)
    tb.content = (tb.content ?? '') + chunk
    ops.flushText()
    return
  }

  const contentSource: 'main' | 'subagent' = scopedSubagent ? 'subagent' : 'main'
  const needsBoundaryNewline =
    state.lastContentSource !== null &&
    state.lastContentSource !== contentSource &&
    state.runningText.length > 0 &&
    !state.runningText.endsWith('\n')
  const scopedParentForBlock = ops.resolveParentForSubagentBlock(
    scopedSubagent,
    scopedParentToolCallId
  )
  const tb = ops.ensureTextBlock(scopedSubagent, scopedParentForBlock, eventTs, spanIdentity)
  const normalizedChunk = needsBoundaryNewline ? `\n${chunk}` : chunk
  tb.content = (tb.content ?? '') + normalizedChunk
  state.runningText += normalizedChunk
  state.lastContentSource = contentSource
  deps.streamingContentRef.current = state.runningText
  ops.flushText()
}
