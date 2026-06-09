import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type {
  StreamEventScope,
  StreamLoopContext,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type ErrorEvent = Extract<PersistedStreamEventEnvelope, { type: 'error' }>

export function handleErrorEvent(
  ctx: StreamLoopContext,
  parsed: ErrorEvent,
  scope: StreamEventScope
): void {
  const { state, ops, deps } = ctx
  state.sawStreamError = true
  deps.setError(parsed.payload.message || parsed.payload.error || 'An error occurred')
  ops.appendInlineErrorTag(
    ops.buildInlineErrorTag(parsed.payload),
    scope.scopedSubagent,
    ops.resolveParentForSubagentBlock(scope.scopedSubagent, scope.scopedParentToolCallId),
    typeof parsed.ts === 'string' ? parsed.ts : undefined
  )
}
