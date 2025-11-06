import { createLogger } from '@/lib/logs/console/logger'
import { buildLoopIndexCondition, DEFAULTS, EDGE } from '@/executor/consts'
import type { DAG } from '@/executor/dag/builder'
import type { LoopScope } from '@/executor/execution/state'
import type { BlockStateController } from '@/executor/execution/types'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { LoopConfigWithNodes } from '@/executor/types/loop'
import {
  buildSentinelEndId,
  buildSentinelStartId,
  extractBaseBlockId,
} from '@/executor/utils/subflow-utils'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedLoop } from '@/serializer/types'

const logger = createLogger('LoopOrchestrator')

export type LoopRoute = typeof EDGE.LOOP_CONTINUE | typeof EDGE.LOOP_EXIT

export interface LoopContinuationResult {
  shouldContinue: boolean
  shouldExit: boolean
  selectedRoute: LoopRoute
  aggregatedResults?: NormalizedBlockOutput[][]
  currentIteration?: number
}

export class LoopOrchestrator {
  constructor(
    private dag: DAG,
    private state: BlockStateController,
    private resolver: VariableResolver
  ) {}

  initializeLoopScope(ctx: ExecutionContext, loopId: string): LoopScope {
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

    switch (loopType) {
      case 'for':
        scope.maxIterations = loopConfig.iterations || DEFAULTS.MAX_LOOP_ITERATIONS
        scope.condition = buildLoopIndexCondition(scope.maxIterations)
        break

      case 'forEach': {
        const items = this.resolveForEachItems(ctx, loopConfig.forEachItems)
        scope.items = items
        scope.maxIterations = items.length
        scope.item = items[0]
        scope.condition = buildLoopIndexCondition(scope.maxIterations)
        break
      }

      case 'while':
        scope.condition = loopConfig.whileCondition
        break

      case 'doWhile':
        if (loopConfig.doWhileCondition) {
          scope.condition = loopConfig.doWhileCondition
        } else {
          scope.maxIterations = loopConfig.iterations || DEFAULTS.MAX_LOOP_ITERATIONS
          scope.condition = buildLoopIndexCondition(scope.maxIterations)
        }
        scope.skipFirstConditionCheck = true
        break

      default:
        throw new Error(`Unknown loop type: ${loopType}`)
    }

    if (!ctx.loopExecutions) {
      ctx.loopExecutions = new Map()
    }
    ctx.loopExecutions.set(loopId, scope)
    return scope
  }

  storeLoopNodeOutput(
    ctx: ExecutionContext,
    loopId: string,
    nodeId: string,
    output: NormalizedBlockOutput
  ): void {
    const scope = ctx.loopExecutions?.get(loopId)
    if (!scope) {
      logger.warn('Loop scope not found for node output storage', { loopId, nodeId })
      return
    }

    const baseId = extractBaseBlockId(nodeId)
    scope.currentIterationOutputs.set(baseId, output)
  }

  evaluateLoopContinuation(ctx: ExecutionContext, loopId: string): LoopContinuationResult {
    const scope = ctx.loopExecutions?.get(loopId)
    if (!scope) {
      logger.error('Loop scope not found during continuation evaluation', { loopId })
      return {
        shouldContinue: false,
        shouldExit: true,
        selectedRoute: EDGE.LOOP_EXIT,
      }
    }

    // Check for cancellation
    if (ctx.isCancelled) {
      logger.info('Loop execution cancelled', { loopId, iteration: scope.iteration })
      return this.createExitResult(ctx, loopId, scope)
    }

    const iterationResults: NormalizedBlockOutput[] = []
    for (const blockOutput of scope.currentIterationOutputs.values()) {
      iterationResults.push(blockOutput)
    }

    if (iterationResults.length > 0) {
      scope.allIterationOutputs.push(iterationResults)
    }

    scope.currentIterationOutputs.clear()

    const isFirstIteration = scope.iteration === 0
    const shouldSkipFirstCheck = scope.skipFirstConditionCheck && isFirstIteration
    if (!shouldSkipFirstCheck) {
      if (!this.evaluateCondition(ctx, scope, scope.iteration + 1)) {
        return this.createExitResult(ctx, loopId, scope)
      }
    }

    scope.iteration++

    if (scope.items && scope.iteration < scope.items.length) {
      scope.item = scope.items[scope.iteration]
    }

    return {
      shouldContinue: true,
      shouldExit: false,
      selectedRoute: EDGE.LOOP_CONTINUE,
      currentIteration: scope.iteration,
    }
  }

  private createExitResult(
    ctx: ExecutionContext,
    loopId: string,
    scope: LoopScope
  ): LoopContinuationResult {
    const results = scope.allIterationOutputs
    this.state.setBlockOutput(loopId, { results }, DEFAULTS.EXECUTION_TIME)

    return {
      shouldContinue: false,
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
      aggregatedResults: results,
      currentIteration: scope.iteration,
    }
  }

  private evaluateCondition(ctx: ExecutionContext, scope: LoopScope, iteration?: number): boolean {
    if (!scope.condition) {
      logger.warn('No condition defined for loop')
      return false
    }

    const currentIteration = scope.iteration
    if (iteration !== undefined) {
      scope.iteration = iteration
    }

    const result = this.evaluateWhileCondition(ctx, scope.condition, scope)

    if (iteration !== undefined) {
      scope.iteration = currentIteration
    }

    return result
  }

  clearLoopExecutionState(loopId: string): void {
    const loopConfig = this.dag.loopConfigs.get(loopId) as LoopConfigWithNodes | undefined
    if (!loopConfig) {
      logger.warn('Loop config not found for state clearing', { loopId })
      return
    }

    const sentinelStartId = buildSentinelStartId(loopId)
    const sentinelEndId = buildSentinelEndId(loopId)
    const loopNodes = loopConfig.nodes

    this.state.unmarkExecuted(sentinelStartId)
    this.state.unmarkExecuted(sentinelEndId)
    for (const loopNodeId of loopNodes) {
      this.state.unmarkExecuted(loopNodeId)
    }
  }

  restoreLoopEdges(loopId: string): void {
    const loopConfig = this.dag.loopConfigs.get(loopId) as LoopConfigWithNodes | undefined
    if (!loopConfig) {
      logger.warn('Loop config not found for edge restoration', { loopId })
      return
    }

    const sentinelStartId = buildSentinelStartId(loopId)
    const sentinelEndId = buildSentinelEndId(loopId)
    const loopNodes = loopConfig.nodes
    const allLoopNodeIds = new Set([sentinelStartId, sentinelEndId, ...loopNodes])

    let restoredCount = 0
    for (const nodeId of allLoopNodeIds) {
      const nodeToRestore = this.dag.nodes.get(nodeId)
      if (!nodeToRestore) continue

      for (const [potentialSourceId, potentialSourceNode] of this.dag.nodes) {
        if (!allLoopNodeIds.has(potentialSourceId)) continue

        for (const [_, edge] of potentialSourceNode.outgoingEdges) {
          if (edge.target === nodeId) {
            const isBackwardEdge =
              edge.sourceHandle === EDGE.LOOP_CONTINUE ||
              edge.sourceHandle === EDGE.LOOP_CONTINUE_ALT

            if (!isBackwardEdge) {
              nodeToRestore.incomingEdges.add(potentialSourceId)
              restoredCount++
            }
          }
        }
      }
    }
  }

  getLoopScope(ctx: ExecutionContext, loopId: string): LoopScope | undefined {
    return ctx.loopExecutions?.get(loopId)
  }

  shouldExecuteLoopNode(_ctx: ExecutionContext, _nodeId: string, _loopId: string): boolean {
    return true
  }

  private findLoopForNode(nodeId: string): string | undefined {
    for (const [loopId, config] of this.dag.loopConfigs) {
      const nodes = (config as any).nodes || []
      if (nodes.includes(nodeId)) {
        return loopId
      }
    }
    return undefined
  }

  private evaluateWhileCondition(
    ctx: ExecutionContext,
    condition: string,
    scope: LoopScope
  ): boolean {
    if (!condition) {
      return false
    }

    try {
      const referencePattern = /<([^>]+)>/g
      let evaluatedCondition = condition

      logger.info('Evaluating loop condition', {
        originalCondition: condition,
        iteration: scope.iteration,
        workflowVariables: ctx.workflowVariables,
      })

      evaluatedCondition = evaluatedCondition.replace(referencePattern, (match) => {
        const resolved = this.resolver.resolveSingleReference(ctx, '', match, scope)
        logger.info('Resolved variable reference in loop condition', {
          reference: match,
          resolvedValue: resolved,
          resolvedType: typeof resolved,
        })
        if (resolved !== undefined) {
          // For booleans and numbers, return as-is (no quotes)
          if (typeof resolved === 'boolean' || typeof resolved === 'number') {
            return String(resolved)
          }
          // For strings that represent booleans, return without quotes
          if (typeof resolved === 'string') {
            const lower = resolved.toLowerCase().trim()
            if (lower === 'true' || lower === 'false') {
              return lower
            }
            return `"${resolved}"`
          }
          // For other types, stringify them
          return JSON.stringify(resolved)
        }
        return match
      })

      const result = Boolean(new Function(`return (${evaluatedCondition})`)())

      logger.info('Loop condition evaluation result', {
        originalCondition: condition,
        evaluatedCondition,
        result,
      })

      return result
    } catch (error) {
      logger.error('Failed to evaluate loop condition', { condition, error })
      return false
    }
  }

  private resolveForEachItems(ctx: ExecutionContext, items: any): any[] {
    if (Array.isArray(items)) {
      return items
    }

    if (typeof items === 'object' && items !== null) {
      return Object.entries(items)
    }

    if (typeof items === 'string') {
      if (items.startsWith('<') && items.endsWith('>')) {
        const resolved = this.resolver.resolveSingleReference(ctx, '', items)
        if (Array.isArray(resolved)) {
          return resolved
        }
        return []
      }

      try {
        const normalized = items.replace(/'/g, '"')
        const parsed = JSON.parse(normalized)
        if (Array.isArray(parsed)) {
          return parsed
        }
        return []
      } catch (error) {
        logger.error('Failed to parse forEach items', { items, error })
        return []
      }
    }

    try {
      const resolved = this.resolver.resolveInputs(ctx, 'loop_foreach_items', { items }).items

      if (Array.isArray(resolved)) {
        return resolved
      }

      logger.warn('ForEach items did not resolve to array', {
        items,
        resolved,
      })

      return []
    } catch (error: any) {
      logger.error('Error resolving forEach items, returning empty array:', {
        error: error.message,
      })
      return []
    }
  }
}
