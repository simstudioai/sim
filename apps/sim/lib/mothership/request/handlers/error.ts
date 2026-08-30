import type { StreamHandler } from './types'
import { flushSubagentThinkingBlock, flushThinkingBlock } from './types'

export const handleErrorEvent: StreamHandler = (event, context) => {
  flushSubagentThinkingBlock(context)
  flushThinkingBlock(context)
  if (event.type !== 'error') {
    context.streamComplete = true
    return
  }
  const message = event.payload.message || event.payload.error
  if (message) {
    context.errors.push(message)
  }
  context.streamComplete = true
}
