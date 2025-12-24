import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

/**
 * Helper function to sleep for a specified number of milliseconds with AbortSignal support.
 * The sleep will be cancelled immediately when the AbortSignal is aborted.
 */
const sleep = async (ms: number, signal?: AbortSignal): Promise<boolean> => {
  if (signal?.aborted) {
    return false
  }

  return new Promise((resolve) => {
    let timeoutId: NodeJS.Timeout | undefined

    const onAbort = () => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve(false)
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    timeoutId = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
      resolve(true)
    }, ms)
  })
}

/**
 * Handler for Wait blocks that pause workflow execution for a time delay
 */
export class WaitBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.WAIT
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    const timeValue = Number.parseInt(inputs.timeValue || '10', 10)
    const timeUnit = inputs.timeUnit || 'seconds'

    if (Number.isNaN(timeValue) || timeValue <= 0) {
      throw new Error('Wait amount must be a positive number')
    }

    let waitMs = timeValue * 1000
    if (timeUnit === 'minutes') {
      waitMs = timeValue * 60 * 1000
    }

    const maxWaitMs = 10 * 60 * 1000
    if (waitMs > maxWaitMs) {
      const maxDisplay = timeUnit === 'minutes' ? '10 minutes' : '600 seconds'
      throw new Error(`Wait time exceeds maximum of ${maxDisplay}`)
    }

    const completed = await sleep(waitMs, ctx.abortSignal)

    if (!completed) {
      return {
        waitDuration: waitMs,
        status: 'cancelled',
      }
    }

    return {
      waitDuration: waitMs,
      status: 'completed',
    }
  }
}
