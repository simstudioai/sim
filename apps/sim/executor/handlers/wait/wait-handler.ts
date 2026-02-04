import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const CANCELLATION_CHECK_INTERVAL_MS = 500

interface SleepOptions {
  signal?: AbortSignal
  executionId?: string
}

const sleep = async (ms: number, options: SleepOptions = {}): Promise<boolean> => {
  const { signal, executionId } = options
  const useRedis = isRedisCancellationEnabled() && !!executionId

  if (signal?.aborted) {
    return false
  }

  return new Promise((resolve) => {
    // biome-ignore lint/style/useConst: needs to be declared before cleanup() but assigned later
    let mainTimeoutId: NodeJS.Timeout | undefined
    let checkIntervalId: NodeJS.Timeout | undefined
    let resolved = false

    const cleanup = () => {
      if (mainTimeoutId) clearTimeout(mainTimeoutId)
      if (checkIntervalId) clearInterval(checkIntervalId)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(false)
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    if (useRedis) {
      checkIntervalId = setInterval(async () => {
        if (resolved) return
        try {
          const cancelled = await isExecutionCancelled(executionId!)
          if (cancelled) {
            resolved = true
            cleanup()
            resolve(false)
          }
        } catch {}
      }, CANCELLATION_CHECK_INTERVAL_MS)
    }

    mainTimeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      cleanup()
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

    const completed = await sleep(waitMs, {
      signal: ctx.abortSignal,
      executionId: ctx.executionId,
    })

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
