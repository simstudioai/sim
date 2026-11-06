import { mothershipErrorText } from '@/lib/mothership/chat/error-tag'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type ErrorEvent = Extract<PersistedStreamEventEnvelope, { type: 'error' }>

/**
 * The inline error tag is folded into the model by `reduceEvent` (scoped to the
 * erroring lane). This handler owns the side effects: flag the stream error and
 * surface the message, then flush the serialized snapshot.
 */
export function handleErrorEvent(ctx: StreamLoopContext, parsed: ErrorEvent): void {
  const { state, ops, deps } = ctx
  state.sawStreamError = true
  deps.setError(mothershipErrorText(parsed.payload) ?? 'An error occurred')
  ops.flush()
}
