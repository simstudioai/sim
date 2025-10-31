import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import type { LoopOrchestrator } from '@/executor/orchestrators/loop-orchestrator'

const logger = createLogger('SentinelBlockHandler')

/**
 * Handler for virtual sentinel nodes that bookend loops.
 * - sentinel_start: Entry point for loop (initializes scope, passes through to internal nodes)
 * - sentinel_end: Exit point that evaluates loop conditions and manages backward edges
 * 
 * All loop logic is delegated to LoopOrchestrator for consolidation.
 */
export class SentinelBlockHandler implements BlockHandler {
  constructor(
    private loopOrchestrator?: LoopOrchestrator
  ) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'sentinel_start' || block.metadata?.id === 'sentinel_end'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput> {
    const sentinelType = block.metadata?.id
    const loopId = (block.metadata as any)?.loopId

    logger.debug('Executing sentinel node', {
      blockId: block.id,
      sentinelType,
      loopId,
    })

    if (sentinelType === 'sentinel_start') {
      return this.handleSentinelStart(block, inputs, context, loopId)
    } else if (sentinelType === 'sentinel_end') {
      return this.handleSentinelEnd(block, inputs, context, loopId)
    }

    return {}
  }

  private async handleSentinelStart(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext,
    loopId?: string
  ): Promise<NormalizedBlockOutput> {
    logger.debug('Sentinel start - loop entry', { blockId: block.id, loopId })

    // Loop scope initialization is handled by ExecutionEngine before execution
    // using LoopOrchestrator.initializeLoopScope()
    // This sentinel_start just passes through to start the loop

    return {
      ...inputs,
      sentinelStart: true,
    }
  }

  private async handleSentinelEnd(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext,
    loopId?: string
  ): Promise<NormalizedBlockOutput> {
    logger.debug('Sentinel end - evaluating loop continuation', { blockId: block.id, loopId })

    if (!loopId || !this.loopOrchestrator) {
      logger.warn('Sentinel end called without loop context or orchestrator')
      return { ...inputs, shouldExit: true, selectedRoute: 'loop_exit' }
    }

    // Delegate all loop continuation logic to LoopOrchestrator
    const continuationResult = this.loopOrchestrator.evaluateLoopContinuation(loopId, context)

    logger.debug('Loop continuation evaluated', {
      loopId,
      shouldContinue: continuationResult.shouldContinue,
      shouldExit: continuationResult.shouldExit,
      iteration: continuationResult.currentIteration,
    })

    if (continuationResult.shouldContinue) {
      // Loop continues - return route for backward edge
      return {
        ...inputs,
        shouldContinue: true,
        shouldExit: false,
        selectedRoute: continuationResult.selectedRoute, // 'loop_continue'
        loopIteration: continuationResult.currentIteration,
      }
    } else {
      // Loop exits - return aggregated results
      return {
        results: continuationResult.aggregatedResults || [],
        shouldContinue: false,
        shouldExit: true,
        selectedRoute: continuationResult.selectedRoute, // 'loop_exit'
        totalIterations: continuationResult.aggregatedResults?.length || 0,
      }
    }
  }

}

