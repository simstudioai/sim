import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('WaitBlockHandler')

/**
 * Helper function to sleep for a specified number of milliseconds
 * On client-side: checks for cancellation every 100ms (non-blocking for UI)
 * On server-side: simple sleep without polling (server execution can't be cancelled mid-flight)
 */
const sleep = async (ms: number, checkCancelled?: () => boolean): Promise<boolean> => {
  const isClientSide = typeof window !== 'undefined'

  if (!isClientSide) {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return true
  }

  const chunkMs = 100
  let elapsed = 0

  while (elapsed < ms) {
    if (checkCancelled?.()) {
      return false
    }

    const sleepTime = Math.min(chunkMs, ms - elapsed)
    await new Promise((resolve) => setTimeout(resolve, sleepTime))
    elapsed += sleepTime
  }

  return true
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

    const checkCancelled = () => {
      return (ctx as any).isCancelled === true
    }

    const completed = await sleep(waitMs, checkCancelled)

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
