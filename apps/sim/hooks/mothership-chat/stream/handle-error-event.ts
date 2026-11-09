import { toRecord } from '@sim/utils/object'
import { mothershipErrorText } from '@/lib/mothership/chat/error-tag'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import type { StreamLoopContext } from '@/hooks/mothership-chat/stream/context'

type ErrorEvent = Extract<PersistedStreamEventEnvelope, { type: 'error' }>

/**
 * The inline error tag is folded into the model by `reduceEvent` (scoped to the
 * erroring lane). This handler owns the side effects: flag the stream error and
 * surface the message, then flush the serialized snapshot.
 */
export function handleErrorEvent(ctx: StreamLoopContext, parsed: ErrorEvent): void {
  const { state, ops, deps } = ctx
  /* A turn for a message a run already applied as steering is refused: the message
     is in the conversation already, so this is no failure to show. */
  if (toRecord(parsed.payload).code === 'input_applied') {
    state.inputApplied = true
    return
  }
  state.sawStreamError = true
  deps.setError(mothershipErrorText(parsed.payload) ?? 'An error occurred')
  ops.flush()
}
