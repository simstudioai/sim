import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import {
  generatePauseContextId,
  mapNodeMetadataToPauseScopes,
} from '@/executor/human-in-the-loop/utils'
import type { BlockHandler, ExecutionContext, PauseMetadata } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

/** Hard ceiling for in-process (synchronous) waits. */
const MAX_INPROCESS_WAIT_MS = 5 * 60 * 1000

/** Hard ceiling for async waits. */
const MAX_ASYNC_WAIT_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Resolves `true` when the full delay elapsed and `false` when the execution was aborted.
 *
 * The abort signal is the only cancellation input. The engine owns cancellation detection —
 * including the durable Redis flag — and aborts this signal, so a wait never has to read
 * cancellation state itself.
 */
const sleepUntilAborted = (ms: number, signal?: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }

    const onAbort = () => {
      clearTimeout(timeoutId)
      resolve(false)
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })

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
 * Default (async=false) waits are held in-process via an interruptible sleep and capped at 5 minutes.
 * When async=true is set, the workflow is always suspended by returning {@link PauseMetadata} with
 * `pauseKind: 'time'`; the cron-driven resume poller (see `/api/resume/poll`) picks the execution back
 * up once `resumeAt` is reached. Async caps at 30 days.
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
    const isAsync = inputs.async === true || inputs.async === 'true'
    const timeValue = Number.parseFloat(inputs.timeValue || '10')
    const timeUnit = isAsync ? inputs.timeUnitLong || 'minutes' : inputs.timeUnit || 'seconds'

    if (!Number.isFinite(timeValue) || timeValue <= 0) {
      throw new Error('Wait amount must be a positive number')
    }

    if (!isWaitUnit(timeUnit)) {
      throw new Error(`Unknown wait unit: ${timeUnit}`)
    }

    if (isAsync && timeUnit === 'seconds') {
      throw new Error('Seconds are not allowed in async mode')
    }

    const waitMs = Math.round(timeValue * UNIT_TO_MS[timeUnit])

    if (isAsync) {
      if (waitMs > MAX_ASYNC_WAIT_MS) {
        throw new Error('Wait time exceeds maximum of 30 days')
      }
    } else if (waitMs > MAX_INPROCESS_WAIT_MS) {
      throw new Error(
        'Wait time exceeds maximum of 5 minutes; enable async mode to wait up to 30 days'
      )
    }

    if (!isAsync) {
      const completed = await sleepUntilAborted(waitMs, ctx.abortSignal)

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
