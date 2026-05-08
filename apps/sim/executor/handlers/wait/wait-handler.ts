import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import {
  generatePauseContextId,
  mapNodeMetadataToPauseScopes,
} from '@/executor/human-in-the-loop/utils'
import type { BlockHandler, ExecutionContext, PauseMetadata } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const CANCELLATION_CHECK_INTERVAL_MS = 500

/** Threshold below which we hold the wait in-process; above, we suspend via PauseMetadata. */
const INPROCESS_MAX_MS = 5 * 60 * 1000

/** Hard ceiling on configurable wait duration. */
const MAX_WAIT_MS = 30 * 24 * 60 * 60 * 1000

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

const UNIT_TO_MS = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
} as const satisfies Record<string, number>

type WaitUnit = keyof typeof UNIT_TO_MS

function isWaitUnit(value: string): value is WaitUnit {
  return value in UNIT_TO_MS
}

/**
 * Handler for Wait blocks that pause workflow execution for a time delay.
 *
 * Waits up to {@link INPROCESS_MAX_MS} are held in-process via an interruptible sleep.
 * Longer waits suspend the workflow by returning {@link PauseMetadata} with
 * `pauseKind: 'time'`; the cron-driven resume poller (see `/api/resume/poll`) picks
 * the execution back up once `resumeAt` is reached.
 */
export class WaitBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.WAIT
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    return this.executeWithNode(ctx, block, inputs, { nodeId: block.id })
  }

  async executeWithNode(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata: {
      nodeId: string
      loopId?: string
      parallelId?: string
      branchIndex?: number
      branchTotal?: number
      originalBlockId?: string
      isLoopNode?: boolean
      executionOrder?: number
    }
  ): Promise<BlockOutput> {
    const timeValue = Number.parseFloat(inputs.timeValue || '10')
    const timeUnit = inputs.timeUnit || 'seconds'

    if (!Number.isFinite(timeValue) || timeValue <= 0) {
      throw new Error('Wait amount must be a positive number')
    }

    if (!isWaitUnit(timeUnit)) {
      throw new Error(`Unknown wait unit: ${timeUnit}`)
    }
    const waitMs = Math.round(timeValue * UNIT_TO_MS[timeUnit])

    if (waitMs > MAX_WAIT_MS) {
      throw new Error('Wait time exceeds maximum of 30 days')
    }

    if (waitMs <= INPROCESS_MAX_MS) {
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

    const { parallelScope, loopScope } = mapNodeMetadataToPauseScopes(ctx, nodeMetadata)
    const contextId = generatePauseContextId(block.id, nodeMetadata, loopScope)
    const now = new Date()
    const resumeAt = new Date(now.getTime() + waitMs).toISOString()

    const pauseMetadata: PauseMetadata = {
      contextId,
      blockId: nodeMetadata.nodeId,
      response: { waitDuration: waitMs, resumeAt },
      timestamp: now.toISOString(),
      parallelScope,
      loopScope,
      pauseKind: 'time',
      resumeAt,
    }

    return {
      waitDuration: waitMs,
      status: 'waiting',
      resumeAt,
      _pauseMetadata: pauseMetadata,
    }
  }
}
