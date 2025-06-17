import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import type { SerializedBlock } from '@/serializer/types'
import type { InputResolver } from '../../resolver'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '../../types'

const logger = createLogger('ParallelBlockHandler')

/**
 * Handler for parallel blocks that manage concurrent execution of blocks.
 * The parallel block sets up the execution state and lets the executor
 * create virtual instances for true parallel execution.
 */
export class ParallelBlockHandler implements BlockHandler {
  constructor(private resolver?: InputResolver) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'parallel'
  }

  async execute(
    block: SerializedBlock,
    _inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing parallel block: ${block.id}`)

    // Get the parallel configuration from the workflow
    const parallel = context.workflow?.parallels?.[block.id]
    if (!parallel) {
      throw new Error(`Parallel configuration not found for block ${block.id}`)
    }

    // Check if we're tracking parallel executions in context
    if (!context.parallelExecutions) {
      context.parallelExecutions = new Map()
    }

    // Get or initialize the parallel state
    let parallelState = context.parallelExecutions.get(block.id)

    // Check if all virtual blocks have completed (even before initialization)
    if (parallelState) {
      const allCompleted = this.checkAllIterationsCompleted(block.id, context)

      if (allCompleted && !context.completedLoops.has(block.id)) {
        logger.info(`All iterations completed for parallel ${block.id}, aggregating results`)

        // Mark this parallel as completed
        context.completedLoops.add(block.id)

        // Check if we already have aggregated results stored (from a previous completion check)
        const existingBlockState = context.blockStates.get(block.id)
        if (existingBlockState?.output?.response?.results) {
          logger.info(`Parallel ${block.id} already has aggregated results, returning them`)
          return existingBlockState.output
        }

        // Aggregate results
        const results = []
        for (let i = 0; i < parallelState.parallelCount; i++) {
          const result = parallelState.executionResults.get(`iteration_${i}`)
          if (result) {
            results.push(result)
          }
        }

        // Store the aggregated results in the block state so subsequent blocks can reference them
        const aggregatedOutput = {
          response: {
            parallelId: block.id,
            parallelCount: parallelState.parallelCount,
            completed: true,
            results,
            message: `Completed all ${parallelState.parallelCount} executions`,
          },
        }

        // Store the aggregated results in context so blocks connected to parallel-end-source can access them
        context.blockStates.set(block.id, {
          output: aggregatedOutput,
          executed: true,
          executionTime: 0, // Parallel coordination doesn't have meaningful execution time
        })

        // Activate the parallel-end-source connection to continue workflow
        const parallelEndConnections =
          context.workflow?.connections.filter(
            (conn) => conn.source === block.id && conn.sourceHandle === 'parallel-end-source'
          ) || []

        for (const conn of parallelEndConnections) {
          context.activeExecutionPath.add(conn.target)
          logger.info(`Activated post-parallel path to ${conn.target}`)
        }

        // Clean up iteration data
        if (context.loopItems.has(`${block.id}_items`)) {
          context.loopItems.delete(`${block.id}_items`)
        }
        if (context.loopItems.has(block.id)) {
          context.loopItems.delete(block.id)
        }
        if (context.loopIterations.has(block.id)) {
          context.loopIterations.delete(block.id)
        }

        return aggregatedOutput
      }
    }

    if (!parallelState) {
      logger.info(`Initializing parallel block ${block.id}`)

      // Get the parallel type and count from block data
      const parallelType = block.config?.params?.parallelType || 'collection'
      const countValue = block.config?.params?.count || 5

      // Evaluate distribution items if provided and type is collection
      let distributionItems: any[] | Record<string, any> | null = null
      if (parallelType === 'collection' && parallel.distribution) {
        distributionItems = await this.evaluateDistributionItems(
          parallel.distribution,
          context,
          block
        )
        logger.info(`Evaluated distribution items for parallel ${block.id}:`, distributionItems)
      }

      // Determine the number of parallel executions
      let parallelCount = 1
      if (parallelType === 'count') {
        // Use the count value for count-based parallel
        parallelCount = Math.min(20, Math.max(1, countValue))
        logger.info(`Parallel ${block.id} will execute ${parallelCount} times based on count`)
      } else if (distributionItems) {
        // Use distribution items length for collection-based parallel
        parallelCount = Array.isArray(distributionItems)
          ? distributionItems.length
          : Object.keys(distributionItems).length
        logger.info(
          `Parallel ${block.id} will execute ${parallelCount} times based on distribution items`
        )
      }

      // Initialize parallel execution state
      parallelState = {
        parallelCount,
        distributionItems,
        completedExecutions: 0,
        executionResults: new Map<string, any>(),
        activeIterations: new Set<number>(),
        currentIteration: 1, // Start at 1 to indicate activation
        parallelType,
      }
      context.parallelExecutions.set(block.id, parallelState)

      // Store the distribution items for access by child blocks
      if (distributionItems) {
        context.loopItems.set(`${block.id}_items`, distributionItems)
      } else if (parallelType === 'count') {
        // For count-based parallel, create an array of indices
        const indices = Array.from({ length: parallelCount }, (_, i) => i)
        context.loopItems.set(`${block.id}_items`, indices)
      }

      // Activate all child nodes (the executor will handle creating virtual instances)
      const parallelStartConnections =
        context.workflow?.connections.filter(
          (conn) => conn.source === block.id && conn.sourceHandle === 'parallel-start-source'
        ) || []

      for (const conn of parallelStartConnections) {
        context.activeExecutionPath.add(conn.target)
        logger.info(`Activated parallel path to ${conn.target}`)
      }

      return {
        response: {
          parallelId: block.id,
          parallelCount,
          distributionType:
            parallelType === 'count' ? 'count' : distributionItems ? 'distributed' : 'simple',
          started: true,
          message: `Initialized ${parallelCount} parallel executions`,
        },
      }
    }

    // Check if all virtual blocks have completed
    const allCompleted = this.checkAllIterationsCompleted(block.id, context)

    if (allCompleted) {
      logger.info(`All iterations completed for parallel ${block.id}`)

      // This case should have been handled earlier, but as a safety check
      if (!context.completedLoops.has(block.id)) {
        // Mark this parallel as completed
        context.completedLoops.add(block.id)

        // Check if we already have aggregated results stored (from a previous completion check)
        const existingBlockState = context.blockStates.get(block.id)
        if (existingBlockState?.output?.response?.results) {
          logger.info(`Parallel ${block.id} already has aggregated results, returning them`)
          return existingBlockState.output
        }

        // Aggregate results
        const results = []
        for (let i = 0; i < parallelState.parallelCount; i++) {
          const result = parallelState.executionResults.get(`iteration_${i}`)
          if (result) {
            results.push(result)
          }
        }

        // Store the aggregated results in the block state so subsequent blocks can reference them
        const aggregatedOutput = {
          response: {
            parallelId: block.id,
            parallelCount: parallelState.parallelCount,
            completed: true,
            results,
            message: `Completed all ${parallelState.parallelCount} executions`,
          },
        }

        // Store the aggregated results in context so blocks connected to parallel-end-source can access them
        context.blockStates.set(block.id, {
          output: aggregatedOutput,
          executed: true,
          executionTime: 0, // Parallel coordination doesn't have meaningful execution time
        })

        // Activate the parallel-end-source connection to continue workflow
        const parallelEndConnections =
          context.workflow?.connections.filter(
            (conn) => conn.source === block.id && conn.sourceHandle === 'parallel-end-source'
          ) || []

        for (const conn of parallelEndConnections) {
          context.activeExecutionPath.add(conn.target)
          logger.info(`Activated post-parallel path to ${conn.target}`)
        }

        // Clean up iteration data
        if (context.loopItems.has(`${block.id}_items`)) {
          context.loopItems.delete(`${block.id}_items`)
        }
        if (context.loopItems.has(block.id)) {
          context.loopItems.delete(block.id)
        }
        if (context.loopIterations.has(block.id)) {
          context.loopIterations.delete(block.id)
        }

        return aggregatedOutput
      }
      // Already completed, return the stored results
      const existingBlockState = context.blockStates.get(block.id)
      if (existingBlockState?.output) {
        return existingBlockState.output
      }
    }

    // Still waiting for iterations to complete
    const completedCount = this.countCompletedIterations(block.id, context)
    return {
      response: {
        parallelId: block.id,
        parallelCount: parallelState.parallelCount,
        completedExecutions: completedCount,
        activeIterations: parallelState.parallelCount - completedCount,
        waiting: true,
        message: `${completedCount} of ${parallelState.parallelCount} iterations completed`,
      },
    }
  }

  /**
   * Checks if all iterations of a parallel block have completed
   */
  private checkAllIterationsCompleted(parallelId: string, context: ExecutionContext): boolean {
    const parallel = context.workflow?.parallels?.[parallelId]
    const parallelState = context.parallelExecutions?.get(parallelId)

    if (!parallel || !parallelState) return false

    // Check each node in the parallel for all iterations
    for (const nodeId of parallel.nodes) {
      for (let i = 0; i < parallelState.parallelCount; i++) {
        const virtualBlockId = `${nodeId}_parallel_${parallelId}_iteration_${i}`
        if (!context.executedBlocks.has(virtualBlockId)) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Counts completed iterations for a parallel block
   */
  private countCompletedIterations(parallelId: string, context: ExecutionContext): number {
    const parallel = context.workflow?.parallels?.[parallelId]
    const parallelState = context.parallelExecutions?.get(parallelId)

    if (!parallel || !parallelState) return 0

    let completedCount = 0

    // Count iterations where all nodes have completed
    for (let i = 0; i < parallelState.parallelCount; i++) {
      let allNodesCompleted = true
      for (const nodeId of parallel.nodes) {
        const virtualBlockId = `${nodeId}_parallel_${parallelId}_iteration_${i}`
        if (!context.executedBlocks.has(virtualBlockId)) {
          allNodesCompleted = false
          break
        }
      }
      if (allNodesCompleted) {
        completedCount++
      }
    }

    return completedCount
  }

  /**
   * Evaluates distribution items expression or value
   */
  private async evaluateDistributionItems(
    distribution: any,
    context: ExecutionContext,
    block: SerializedBlock
  ): Promise<any[] | Record<string, any> | null> {
    // If already an array or object, return as-is
    if (
      Array.isArray(distribution) ||
      (typeof distribution === 'object' && distribution !== null)
    ) {
      return distribution
    }

    // If it's a string expression, try to evaluate it
    if (typeof distribution === 'string') {
      try {
        const trimmed = distribution.trim()
        if (trimmed.startsWith('//') || trimmed === '') {
          return []
        }

        // Try to parse as JSON first
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            return JSON.parse(trimmed)
          } catch {
            // Continue to expression evaluation
          }
        }

        // If we have a resolver, use it to resolve any block references in the expression
        if (this.resolver) {
          const resolved = this.resolver.resolveBlockReferences(distribution, context, block)

          // Try to parse the resolved value
          try {
            return JSON.parse(resolved)
          } catch {
            // If it's not valid JSON, try to evaluate as an expression
            try {
              const result = new Function(`return ${resolved}`)()
              if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
                return result
              }
            } catch (e) {
              logger.error(`Error evaluating distribution expression: ${resolved}`, e)
            }
          }
        }

        logger.warn(`Distribution expression evaluation not fully implemented: ${distribution}`)
        return null
      } catch (error) {
        logger.error(`Error evaluating distribution items:`, error)
        return null
      }
    }

    return null
  }
}
