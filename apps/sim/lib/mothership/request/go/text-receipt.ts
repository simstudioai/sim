import { FatalSseEventError, StreamContinuityError } from '@/lib/mothership/request/go/parser'
import type { StreamEvent } from '@/lib/mothership/request/types'

/** Reconcile before forwarding or persistence so replay cannot duplicate visible text. */
export function reconcileTextEvent(event: StreamEvent, received: string): StreamEvent | null {
  if (
    event.type === 'complete' &&
    event.payload.status === 'complete' &&
    event.payload.textLength !== undefined
  ) {
    if (!Number.isSafeInteger(event.payload.textLength) || event.payload.textLength < 0)
      throw new FatalSseEventError('The response has an invalid final text length.')
    if (event.payload.textLength > received.length)
      throw new StreamContinuityError('The response completed before all text was received.')
    if (event.payload.textLength < received.length)
      throw new FatalSseEventError('The response completed with a different text length.')
  }
  if (
    event.type !== 'text' ||
    event.scope?.lane === 'subagent' ||
    event.payload.channel !== 'assistant'
  )
    return event
  const { text, textOffset } = event.payload
  if (textOffset === undefined) return event
  if (textOffset > received.length)
    throw new StreamContinuityError('The response is missing text before this position.')
  const overlap = Math.min(text.length, received.length - textOffset)
  if (received.slice(textOffset, textOffset + overlap) !== text.slice(0, overlap))
    throw new FatalSseEventError('Replayed response text differs from text already received.')
  if (overlap === text.length) return null
  return {
    ...event,
    payload: { ...event.payload, text: text.slice(overlap), textOffset: received.length },
  }
}
