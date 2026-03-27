import { getEventData } from '@/lib/copilot/request/sse-utils'
import type { StreamHandler } from './types'

export const handleErrorEvent: StreamHandler = (event, context) => {
  const d = getEventData(event)
  const message = (d?.message || d?.error) as string | undefined
  if (message) {
    context.errors.push(message)
  }
  context.streamComplete = true
}
