import { toRecord } from '@sim/utils/object'
import { mothershipErrorText } from '@/lib/mothership/chat/error-tag'
import type { StreamHandler } from './types'
import { flushSubagentThinkingBlock, flushThinkingBlock } from './types'

export const handleErrorEvent: StreamHandler = (event, context) => {
  flushSubagentThinkingBlock(context)
  flushThinkingBlock(context)
  if (event.type !== 'error') {
    context.streamComplete = true
    return
  }
  if (toRecord(event.payload).code === 'input_applied') context.inputApplied = true
  const message = mothershipErrorText(event.payload)
  if (message) {
    context.errors.push(message)
  }
  context.streamComplete = true
}
