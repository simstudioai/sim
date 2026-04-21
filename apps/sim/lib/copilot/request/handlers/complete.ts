import type { StreamHandler } from './types'
import { flushSubagentThinkingBlock, flushThinkingBlock } from './types'

export const handleCompleteEvent: StreamHandler = (event, context) => {
  flushSubagentThinkingBlock(context)
  flushThinkingBlock(context)
  if (event.type !== 'complete') {
    context.streamComplete = true
    return
  }

  if (event.payload.usage) {
    context.usage = {
      prompt: (context.usage?.prompt || 0) + (event.payload.usage.input_tokens || 0),
      completion: (context.usage?.completion || 0) + (event.payload.usage.output_tokens || 0),
    }
  }

  if (event.payload.cost) {
    context.cost = {
      input: (context.cost?.input || 0) + (event.payload.cost.input || 0),
      output: (context.cost?.output || 0) + (event.payload.cost.output || 0),
      total: (context.cost?.total || 0) + (event.payload.cost.total || 0),
    }
  }

  context.streamComplete = true
}
