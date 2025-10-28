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

  // Server-side: simple sleep without polling
  if (!isClientSide) {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return true
  }

  // Client-side: check for cancellation every 100ms
  const chunkMs = 100
  let elapsed = 0

  while (elapsed < ms) {
    // Check if execution was cancelled
    if (checkCancelled?.()) {
      return false // Sleep was interrupted
    }

    // Sleep for a chunk or remaining time, whichever is smaller
    const sleepTime = Math.min(chunkMs, ms - elapsed)
    await new Promise((resolve) => setTimeout(resolve, sleepTime))
    elapsed += sleepTime
  }

  return true // Sleep completed normally
}

/**
 * Handler for Wait blocks that pause workflow execution for a time delay
 */
export class WaitBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.WAIT
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    logger.info(`Executing Wait block: ${block.id}`, { inputs })

    // Parse the wait duration
    const timeValue = Number.parseInt(inputs.timeValue || '10', 10)
    const timeUnit = inputs.timeUnit || 'seconds'

    // Validate time value
    if (Number.isNaN(timeValue) || timeValue <= 0) {
      throw new Error('Wait amount must be a positive number')
    }

    // Calculate wait time in milliseconds
    let waitMs = timeValue * 1000 // Default to seconds
    if (timeUnit === 'minutes') {
      waitMs = timeValue * 60 * 1000
    }

    // Enforce 10-minute maximum (600,000 ms)
    const maxWaitMs = 10 * 60 * 1000
    if (waitMs > maxWaitMs) {
      const maxDisplay = timeUnit === 'minutes' ? '10 minutes' : '600 seconds'
      throw new Error(`Wait time exceeds maximum of ${maxDisplay}`)
    }

    logger.info(`Waiting for ${waitMs}ms (${timeValue} ${timeUnit})`)

    // Actually sleep for the specified duration
    // The executor updates context.isCancelled when cancel() is called
    const checkCancelled = () => {
      // Check if execution was marked as cancelled in the context
      return (context as any).isCancelled === true
    }

    const completed = await sleep(waitMs, checkCancelled)

    if (!completed) {
      logger.info('Wait was interrupted by cancellation')
      return {
        waitDuration: waitMs,
        status: 'cancelled',
      }
    }

    logger.info('Wait completed successfully')
    return {
      waitDuration: waitMs,
      status: 'completed',
    }
  }
}
