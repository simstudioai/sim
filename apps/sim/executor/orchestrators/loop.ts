/**
 * LoopOrchestrator
 * 
 * Consolidates ALL loop-related logic in one place:
 * - Loop scope initialization and management
 * - Iteration tracking and incrementing
 * - Condition evaluation (for/forEach/while/doWhile)
 * - Backward edge decision logic
 * - Result aggregation
 * - Loop state clearing for continuation
 * 
 * This is the single source of truth for loop execution.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedLoop } from '@/serializer/types'
import type { ExecutionState, LoopScope } from '../execution/state'
import type { VariableResolver } from '../variables/resolver'
import type { DAG, DAGNode } from '../dag/builder'

const logger = createLogger('LoopOrchestrator')

/**
 * Result of evaluating whether a loop should continue
 */
export interface LoopContinuationResult {
  shouldContinue: boolean
  shouldExit: boolean
  selectedRoute: 'loop_continue' | 'loop_exit'
  aggregatedResults?: NormalizedBlockOutput[][]
  currentIteration?: number
}

/**
 * Manages all aspects of loop execution throughout the workflow lifecycle
 */
export class LoopOrchestrator {
  constructor(
    private dag: DAG,
    private state: ExecutionState,
    private resolver: VariableResolver
  ) {}

  /**
   * Initialize a loop scope before first execution
   * Handles all loop types: for, forEach, while, doWhile
   */
  initializeLoopScope(loopId: string, context: ExecutionContext): LoopScope {
    const loopConfig = this.dag.loopConfigs.get(loopId) as SerializedLoop | undefined
    if (!loopConfig) {
      throw new Error(`Loop config not found: ${loopId}`)
    }

    const scope: LoopScope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
    }

    const loopType = loopConfig.loopType

    logger.debug('Initializing loop scope', { loopId, loopType })

    // Configure scope based on loop type
    switch (loopType) {
      case 'for':
        scope.maxIterations = loopConfig.iterations || 1
        scope.condition = `<loop.index> < ${scope.maxIterations}`
        logger.debug('For loop initialized', { loopId, maxIterations: scope.maxIterations })
        break

      case 'forEach':
        const items = this.resolveForEachItems(loopConfig.forEachItems, context)
        scope.items = items
        scope.maxIterations = items.length
        scope.item = items[0]
        scope.condition = `<loop.index> < ${scope.maxIterations}`
        logger.debug('ForEach loop initialized', { loopId, itemCount: items.length })
        break

      case 'while':
        scope.condition = loopConfig.whileCondition
        logger.debug('While loop initialized', { loopId, condition: scope.condition })
        break

      case 'doWhile':
        if (loopConfig.doWhileCondition) {
          scope.condition = loopConfig.doWhileCondition
        } else {
          scope.maxIterations = loopConfig.iterations || 1
          scope.condition = `<loop.index> < ${scope.maxIterations}`
        }
        scope.skipFirstConditionCheck = true
        logger.debug('DoWhile loop initialized', { loopId, condition: scope.condition })
        break

      default:
        throw new Error(`Unknown loop type: ${loopType}`)
    }

    this.state.setLoopScope(loopId, scope)
    return scope
  }

  /**
   * Store output from a block executing inside a loop
   * This is called by ExecutionEngine for each loop node completion
   */
  storeLoopNodeOutput(loopId: string, nodeId: string, output: NormalizedBlockOutput): void {
    const scope = this.state.getLoopScope(loopId)
    if (!scope) {
      logger.warn('Loop scope not found for node output storage', { loopId, nodeId })
      return
    }

    const baseId = this.extractBaseId(nodeId)
    scope.currentIterationOutputs.set(baseId, output)

    logger.debug('Stored loop node output', {
      loopId,
      nodeId: baseId,
      iteration: scope.iteration,
      outputsCount: scope.currentIterationOutputs.size,
    })
  }

  /**
   * Evaluate whether a loop should continue to the next iteration
   * This is the core loop continuation logic, called by sentinel_end
   * 
   * Returns routing information for ExecutionEngine to activate correct edge
   */
  evaluateLoopContinuation(
    loopId: string,
    context: ExecutionContext
  ): LoopContinuationResult {
    const scope = this.state.getLoopScope(loopId)
    if (!scope) {
      logger.error('Loop scope not found during continuation evaluation', { loopId })
      return {
        shouldContinue: false,
        shouldExit: true,
        selectedRoute: 'loop_exit',
      }
    }

    // Collect outputs from current iteration
    const iterationResults: NormalizedBlockOutput[] = []
    for (const blockOutput of scope.currentIterationOutputs.values()) {
      iterationResults.push(blockOutput)
    }

    if (iterationResults.length > 0) {
      scope.allIterationOutputs.push(iterationResults)
      logger.debug('Collected iteration results', {
        loopId,
        iteration: scope.iteration,
        resultsCount: iterationResults.length,
      })
    }

    // Clear current iteration outputs
    scope.currentIterationOutputs.clear()

    // Check if we should continue
    const isFirstIteration = scope.iteration === 0
    const shouldSkipFirstCheck = scope.skipFirstConditionCheck && isFirstIteration

    if (!shouldSkipFirstCheck) {
      // Evaluate condition for NEXT iteration (iteration + 1)
      if (!this.evaluateCondition(scope, context, scope.iteration + 1)) {
        logger.debug('Loop condition false for next iteration - exiting', {
          loopId,
          currentIteration: scope.iteration,
          nextIteration: scope.iteration + 1,
        })
        return this.createExitResult(loopId, scope, context)
      }
    }

    // Condition passed - prepare for next iteration
    scope.iteration++

    // Update current item for forEach loops
    if (scope.items && scope.iteration < scope.items.length) {
      scope.item = scope.items[scope.iteration]
    }

    logger.debug('Loop continuing to next iteration', {
      loopId,
      iteration: scope.iteration,
      maxIterations: scope.maxIterations,
    })

    return {
      shouldContinue: true,
      shouldExit: false,
      selectedRoute: 'loop_continue',
      currentIteration: scope.iteration,
    }
  }

  /**
   * Clear executed state for all loop nodes to allow re-execution
   * This is called by ExecutionEngine when loop continues
   */
  clearLoopExecutionState(loopId: string, executedBlocks: Set<string>): void {
    const loopConfig = this.dag.loopConfigs.get(loopId)
    if (!loopConfig) {
      logger.warn('Loop config not found for state clearing', { loopId })
      return
    }

    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const sentinelEndId = `loop-${loopId}-sentinel-end`
    const loopNodes = (loopConfig as any).nodes as string[]

    // Clear executed state for sentinels and all loop nodes
    executedBlocks.delete(sentinelStartId)
    executedBlocks.delete(sentinelEndId)

    for (const loopNodeId of loopNodes) {
      executedBlocks.delete(loopNodeId)
    }

    logger.debug('Cleared loop execution state', {
      loopId,
      nodesCleared: loopNodes.length + 2, // +2 for sentinels
    })
  }

  /**
   * Restore incoming edges for all loop nodes
   * This is called by ExecutionEngine when loop continues
   */
  restoreLoopEdges(loopId: string): void {
    const loopConfig = this.dag.loopConfigs.get(loopId)
    if (!loopConfig) {
      logger.warn('Loop config not found for edge restoration', { loopId })
      return
    }

    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const sentinelEndId = `loop-${loopId}-sentinel-end`
    const loopNodes = (loopConfig as any).nodes as string[]

    // Build set of all loop-related nodes
    const allLoopNodeIds = new Set([sentinelStartId, sentinelEndId, ...loopNodes])

    let restoredCount = 0

    // Restore incoming edges for all loop nodes
    for (const nodeId of allLoopNodeIds) {
      const nodeToRestore = this.dag.nodes.get(nodeId)
      if (!nodeToRestore) continue

      // Find all nodes that have edges pointing to this node
      for (const [potentialSourceId, potentialSourceNode] of this.dag.nodes) {
        if (!allLoopNodeIds.has(potentialSourceId)) continue // Only from loop nodes

        for (const [_, edge] of potentialSourceNode.outgoingEdges) {
          if (edge.target === nodeId) {
            // Skip backward edges (they start inactive)
            const isBackwardEdge =
              edge.sourceHandle === 'loop_continue' ||
              edge.sourceHandle === 'loop-continue-source'

            if (!isBackwardEdge) {
              nodeToRestore.incomingEdges.add(potentialSourceId)
              restoredCount++
            }
          }
        }
      }
    }

    logger.debug('Restored loop edges', { loopId, edgesRestored: restoredCount })
  }

  /**
   * Get current loop scope for a loop ID
   */
  getLoopScope(loopId: string): LoopScope | undefined {
    return this.state.getLoopScope(loopId)
  }

  /**
   * Check if a node should execute (used for conditional execution checks)
   */
  shouldExecuteLoopNode(nodeId: string, loopId: string, context: ExecutionContext): boolean {
    // For now, always allow execution
    // This can be extended for more complex loop logic in the future
    return true
  }

  /**
   * PRIVATE METHODS
   */

  /**
   * Create exit result with aggregated outputs
   */
  private createExitResult(
    loopId: string,
    scope: LoopScope,
    context: ExecutionContext
  ): LoopContinuationResult {
    const results = scope.allIterationOutputs

    // Store aggregated results in block states
    context.blockStates?.set(loopId, {
      output: { results },
      executed: true,
      executionTime: 0,
    })

    logger.debug('Loop exiting with aggregated results', {
      loopId,
      totalIterations: scope.allIterationOutputs.length,
    })

    return {
      shouldContinue: false,
      shouldExit: true,
      selectedRoute: 'loop_exit',
      aggregatedResults: results,
    }
  }

  /**
   * Evaluate loop condition
   * Supports evaluating for current iteration or a future iteration
   */
  private evaluateCondition(
    scope: LoopScope,
    context: ExecutionContext,
    iteration?: number
  ): boolean {
    if (!scope.condition) {
      logger.warn('No condition defined for loop')
      return false
    }

    // Temporarily set iteration if evaluating for future iteration
    const currentIteration = scope.iteration
    if (iteration !== undefined) {
      scope.iteration = iteration
    }

    const result = this.evaluateWhileCondition(scope.condition, scope, context)

    // Restore original iteration
    if (iteration !== undefined) {
      scope.iteration = currentIteration
    }

    return result
  }

  /**
   * Evaluate a while condition expression
   * Resolves all references and evaluates the expression
   */
  private evaluateWhileCondition(
    condition: string,
    scope: LoopScope,
    context: ExecutionContext
  ): boolean {
    if (!condition) {
      return false
    }

    try {
      const referencePattern = /<([^>]+)>/g
      let evaluatedCondition = condition
      const replacements: Record<string, string> = {}

      // Resolve all references in the condition
      evaluatedCondition = evaluatedCondition.replace(referencePattern, (match) => {
        const resolved = this.resolver.resolveSingleReference(match, '', context, scope)
        if (resolved !== undefined) {
          if (typeof resolved === 'string') {
            replacements[match] = `"${resolved}"`
            return `"${resolved}"`
          }
          replacements[match] = String(resolved)
          return String(resolved)
        }
        return match
      })

      const result = Boolean(eval(`(${evaluatedCondition})`))

      logger.debug('Evaluated loop condition', {
        condition,
        replacements,
        evaluatedCondition,
        result,
        iteration: scope.iteration,
      })

      return result
    } catch (error) {
      logger.error('Failed to evaluate loop condition', { condition, error })
      return false
    }
  }

  /**
   * Resolve forEach items from various input formats
   */
  private resolveForEachItems(items: any, context: ExecutionContext): any[] {
    if (Array.isArray(items)) {
      return items
    }

    if (typeof items === 'object' && items !== null) {
      return Object.entries(items)
    }

    if (typeof items === 'string') {
      // Handle block references like <previousBlock.output>
      if (items.startsWith('<') && items.endsWith('>')) {
        const resolved = this.resolver.resolveSingleReference(items, '', context)
        return Array.isArray(resolved) ? resolved : []
      }

      // Handle JSON strings
      try {
        const normalized = items.replace(/'/g, '"')
        const parsed = JSON.parse(normalized)
        return Array.isArray(parsed) ? parsed : []
      } catch (error) {
        logger.error('Failed to parse forEach items', { items, error })
        return []
      }
    }

    return []
  }

  /**
   * Extract base ID from node ID (removes parallel branch suffix)
   */
  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }
}

