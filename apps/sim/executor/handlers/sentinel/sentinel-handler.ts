import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('SentinelBlockHandler')

/**
 * Handler for virtual sentinel nodes that bookend loops.
 * - sentinel_start: Entry point for loop (initializes scope, passes through to internal nodes)
 * - sentinel_end: Exit point that evaluates loop conditions and manages backward edges
 */
export class SentinelBlockHandler implements BlockHandler {
  constructor(
    private subflowManager?: any,
    private dag?: any
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

    // Note: Loop scope initialization is handled by ExecutionEngine before execution
    // This sentinel_start just passes through to start the loop

    // Pass through - sentinel_start just gates entry
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

    if (!loopId || !this.subflowManager || !this.dag) {
      logger.warn('Sentinel end called without loop context')
      return { ...inputs, shouldExit: true, selectedRoute: 'loop_exit' }
    }

    const loopConfig = this.dag.loopConfigs?.get(loopId)
    if (!loopConfig) {
      logger.warn('Loop config not found', { loopId })
      return { ...inputs, shouldExit: true, selectedRoute: 'loop_exit' }
    }

    // Get the loop scope from SubflowManager's internal state
    const scope = (this.subflowManager as any).state.getLoopScope(loopId)
    if (!scope) {
      logger.warn('Loop scope not found', { loopId })
      return { ...inputs, shouldExit: true, selectedRoute: 'loop_exit' }
    }

    // Collect iteration outputs (already stored by loop nodes in handleLoopNodeOutput)
    const iterationResults: NormalizedBlockOutput[] = []
    for (const blockOutput of scope.currentIterationOutputs.values()) {
      iterationResults.push(blockOutput)
    }

    if (iterationResults.length > 0) {
      scope.allIterationOutputs.push(iterationResults)
    }

    scope.currentIterationOutputs.clear()

    // Check if loop should continue using SubflowManager's internal method
    // Note: shouldLoopContinue already increments scope.iteration and updates scope.item
    const shouldContinue = (this.subflowManager as any).shouldLoopContinue(loopId, scope, context)

    if (shouldContinue) {
      logger.debug('Loop continuing', {
        loopId,
        iteration: scope.iteration,
        maxIterations: scope.maxIterations,
      })

      // Signal to continue loop via selectedRoute
      // The ExecutionEngine will use this to activate the backward edge
      return {
        ...inputs,
        shouldContinue: true,
        shouldExit: false,
        selectedRoute: 'loop_continue', // This will match the backward edge sourceHandle
        loopIteration: scope.iteration,
      }
    } else {
      // Aggregate results and exit
      logger.debug('Loop exiting', {
        loopId,
        totalIterations: scope.allIterationOutputs.length,
      })

      const results = scope.allIterationOutputs

      // Store aggregated results
      context.blockStates?.set(loopId, {
        output: { results },
        executed: true,
        executionTime: 0,
      })

      return {
        results,
        shouldContinue: false,
        shouldExit: true,
        selectedRoute: 'loop_exit', // This will match the forward exit edge sourceHandle
        totalIterations: scope.allIterationOutputs.length,
      }
    }
  }

}

