import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import { executeInIsolatedVM } from '@/lib/execution/isolated-vm'
import { buildLoopIndexCondition, DEFAULTS, EDGE } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import type { LoopScope } from '@/executor/execution/state'
import type { BlockStateController, ContextExtensions } from '@/executor/execution/types'
import {
  type ExecutionContext,
  getNextExecutionOrder,
  type NormalizedBlockOutput,
} from '@/executor/types'
import type { LoopConfigWithNodes } from '@/executor/types/loop'
import { replaceValidReferences } from '@/executor/utils/reference-validation'
import {
  addSubflowErrorLog,
  buildSentinelEndId,
  buildSentinelStartId,
  extractBaseBlockId,
  resolveArrayInput,
  validateMaxCount,
} from '@/executor/utils/subflow-utils'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedLoop } from '@/serializer/types'

const logger = createLogger('LoopOrchestrator')

const LOOP_CONDITION_TIMEOUT_MS = 5000

export type LoopRoute = typeof EDGE.LOOP_CONTINUE | typeof EDGE.LOOP_EXIT

export interface LoopContinuationResult {
  shouldContinue: boolean
  shouldExit: boolean
  selectedRoute: LoopRoute
  aggregatedResults?: NormalizedBlockOutput[][]
}

export class LoopOrchestrator {
  private edgeManager: EdgeManager | null = null
  private contextExtensions: ContextExtensions | null = null

  constructor(
    private dag: DAG,
    private state: BlockStateController,
    private resolver: VariableResolver
  ) {}

  setContextExtensions(contextExtensions: ContextExtensions): void {
    this.contextExtensions = contextExtensions
  }

  setEdgeManager(edgeManager: EdgeManager): void {
    this.edgeManager = edgeManager
  }

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
      case 'for': {
        scope.loopType = 'for'
        const requestedIterations = loopConfig.iterations || DEFAULTS.MAX_LOOP_ITERATIONS

        const iterationError = validateMaxCount(
          requestedIterations,
          DEFAULTS.MAX_LOOP_ITERATIONS,
          'For loop iterations'
        )
        if (iterationError) {
          logger.error(iterationError, { loopId, requestedIterations })
          this.addLoopErrorLog(ctx, loopId, loopType, iterationError, {
            iterations: requestedIterations,
          })
          scope.maxIterations = 0
          scope.validationError = iterationError
          scope.condition = buildLoopIndexCondition(0)
          ctx.loopExecutions?.set(loopId, scope)
          throw new Error(iterationError)
        }

        scope.maxIterations = requestedIterations
        scope.condition = buildLoopIndexCondition(scope.maxIterations)
        break
      }

      case 'forEach': {
        scope.loopType = 'forEach'
        let items: any[]
        try {
          items = this.resolveForEachItems(ctx, loopConfig.forEachItems)
        } catch (error) {
          const errorMessage = `ForEach loop resolution failed: ${error instanceof Error ? error.message : String(error)}`
          logger.error(errorMessage, { loopId, forEachItems: loopConfig.forEachItems })
          this.addLoopErrorLog(ctx, loopId, loopType, errorMessage, {
            forEachItems: loopConfig.forEachItems,
          })
          scope.items = []
          scope.maxIterations = 0
          scope.validationError = errorMessage
          scope.condition = buildLoopIndexCondition(0)
          ctx.loopExecutions?.set(loopId, scope)
          throw new Error(errorMessage)
        }

        const sizeError = validateMaxCount(
          items.length,
          DEFAULTS.MAX_FOREACH_ITEMS,
          'ForEach loop collection size'
        )
        if (sizeError) {
          logger.error(sizeError, { loopId, collectionSize: items.length })
          this.addLoopErrorLog(ctx, loopId, loopType, sizeError, {
            forEachItems: loopConfig.forEachItems,
            collectionSize: items.length,
          })
          scope.items = []
          scope.maxIterations = 0
          scope.validationError = sizeError
          scope.condition = buildLoopIndexCondition(0)
          ctx.loopExecutions?.set(loopId, scope)
          throw new Error(sizeError)
        }

        scope.items = items
        scope.maxIterations = items.length
        scope.item = items[0]
        scope.condition = buildLoopIndexCondition(scope.maxIterations)
        break
      }

      case 'while':
        scope.loopType = 'while'
        scope.condition = loopConfig.whileCondition
        break

      case 'doWhile': {
        scope.loopType = 'doWhile'
        if (loopConfig.doWhileCondition) {
          scope.condition = loopConfig.doWhileCondition
        } else {
          const requestedIterations = loopConfig.iterations || DEFAULTS.MAX_LOOP_ITERATIONS

          const iterationError = validateMaxCount(
            requestedIterations,
            DEFAULTS.MAX_LOOP_ITERATIONS,
            'Do-While loop iterations'
          )
          if (iterationError) {
            logger.error(iterationError, { loopId, requestedIterations })
            this.addLoopErrorLog(ctx, loopId, loopType, iterationError, {
              iterations: requestedIterations,
            })
            scope.maxIterations = 0
            scope.validationError = iterationError
            scope.condition = buildLoopIndexCondition(0)
            ctx.loopExecutions?.set(loopId, scope)
            throw new Error(iterationError)
          }

          scope.maxIterations = requestedIterations
          scope.condition = buildLoopIndexCondition(scope.maxIterations)
        }
        break
      }

      default:
        throw new Error(`Unknown loop type: ${loopType}`)
    }

    if (!ctx.loopExecutions) {
      ctx.loopExecutions = new Map()
    }
    ctx.loopExecutions.set(loopId, scope)
    return scope
  }

  private addLoopErrorLog(
    ctx: ExecutionContext,
    loopId: string,
    loopType: string,
    errorMessage: string,
    inputData?: any
  ): void {
    addSubflowErrorLog(
      ctx,
      loopId,
      'loop',
      errorMessage,
      { loopType, ...inputData },
      this.contextExtensions
    )
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

  async evaluateLoopContinuation(
    ctx: ExecutionContext,
    loopId: string
  ): Promise<LoopContinuationResult> {
    const scope = ctx.loopExecutions?.get(loopId)
    if (!scope) {
      logger.error('Loop scope not found during continuation evaluation', { loopId })
      return {
        shouldContinue: false,
        shouldExit: true,
        selectedRoute: EDGE.LOOP_EXIT,
      }
    }

    const useRedis = isRedisCancellationEnabled() && !!ctx.executionId
    let isCancelled = false
    if (useRedis) {
      isCancelled = await isExecutionCancelled(ctx.executionId!)
    } else {
      isCancelled = ctx.abortSignal?.aborted ?? false
    }
    if (isCancelled) {
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

    if (!(await this.evaluateCondition(ctx, scope, scope.iteration + 1))) {
      return this.createExitResult(ctx, loopId, scope)
    }

    scope.iteration++

    if (scope.items && scope.iteration < scope.items.length) {
      scope.item = scope.items[scope.iteration]
    }

    return {
      shouldContinue: true,
      shouldExit: false,
      selectedRoute: EDGE.LOOP_CONTINUE,
    }
  }

  private createExitResult(
    ctx: ExecutionContext,
    loopId: string,
    scope: LoopScope
  ): LoopContinuationResult {
    const results = scope.allIterationOutputs
    const output = { results }
    this.state.setBlockOutput(loopId, output, DEFAULTS.EXECUTION_TIME)

    // Emit onBlockComplete for the loop container so the UI can track it
    if (this.contextExtensions?.onBlockComplete) {
      const now = new Date().toISOString()
      this.contextExtensions.onBlockComplete(loopId, 'Loop', 'loop', {
        output,
        executionTime: DEFAULTS.EXECUTION_TIME,
        startedAt: now,
        executionOrder: getNextExecutionOrder(ctx),
        endedAt: now,
      })
    }

    return {
      shouldContinue: false,
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
      aggregatedResults: results,
    }
  }

  private async evaluateCondition(
    ctx: ExecutionContext,
    scope: LoopScope,
    iteration?: number
  ): Promise<boolean> {
    if (!scope.condition) {
      logger.warn('No condition defined for loop')
      return false
    }

    const currentIteration = scope.iteration
    if (iteration !== undefined) {
      scope.iteration = iteration
    }

    const result = await this.evaluateWhileCondition(ctx, scope.condition, scope)

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

    if (this.edgeManager) {
      this.edgeManager.clearDeactivatedEdgesForNodes(allLoopNodeIds)
    }

    for (const nodeId of allLoopNodeIds) {
      const nodeToRestore = this.dag.nodes.get(nodeId)
      if (!nodeToRestore) continue

      for (const [potentialSourceId, potentialSourceNode] of this.dag.nodes) {
        if (!allLoopNodeIds.has(potentialSourceId)) continue

        for (const [, edge] of potentialSourceNode.outgoingEdges) {
          if (edge.target === nodeId) {
            const isBackwardEdge =
              edge.sourceHandle === EDGE.LOOP_CONTINUE ||
              edge.sourceHandle === EDGE.LOOP_CONTINUE_ALT

            if (!isBackwardEdge) {
              nodeToRestore.incomingEdges.add(potentialSourceId)
            }
          }
        }
      }
    }
  }

  getLoopScope(ctx: ExecutionContext, loopId: string): LoopScope | undefined {
    return ctx.loopExecutions?.get(loopId)
  }

  /**
   * Evaluates the initial condition for loops at the sentinel start.
   * - For while loops, the condition must be checked BEFORE the first iteration.
   * - For forEach loops, skip if the items array is empty.
   * - For for loops, skip if maxIterations is 0.
   * - For doWhile loops, always execute at least once.
   *
   * @returns true if the loop should execute, false if it should be skipped
   */
  async evaluateInitialCondition(ctx: ExecutionContext, loopId: string): Promise<boolean> {
    const scope = ctx.loopExecutions?.get(loopId)
    if (!scope) {
      logger.warn('Loop scope not found for initial condition evaluation', { loopId })
      return true
    }

    if (scope.loopType === 'forEach') {
      if (!scope.items || scope.items.length === 0) {
        logger.info('ForEach loop has empty collection, skipping loop body', { loopId })
        this.state.setBlockOutput(loopId, { results: [] }, DEFAULTS.EXECUTION_TIME)
        return false
      }
      return true
    }

    // for: skip if maxIterations is 0
    if (scope.loopType === 'for') {
      if (scope.maxIterations === 0) {
        logger.info('For loop has 0 iterations, skipping loop body', { loopId })
        // Set empty output for the loop
        this.state.setBlockOutput(loopId, { results: [] }, DEFAULTS.EXECUTION_TIME)
        return false
      }
      return true
    }

    // doWhile: always execute at least once
    if (scope.loopType === 'doWhile') {
      return true
    }

    // while: check condition before first iteration
    if (scope.loopType === 'while') {
      if (!scope.condition) {
        logger.warn('No condition defined for while loop', { loopId })
        return false
      }

      const result = await this.evaluateWhileCondition(ctx, scope.condition, scope)
      logger.info('While loop initial condition evaluation', {
        loopId,
        condition: scope.condition,
        result,
      })

      return result
    }

    return true
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

  private async evaluateWhileCondition(
    ctx: ExecutionContext,
    condition: string,
    scope: LoopScope
  ): Promise<boolean> {
    if (!condition) {
      return false
    }

    try {
      logger.info('Evaluating loop condition', {
        originalCondition: condition,
        iteration: scope.iteration,
        workflowVariables: ctx.workflowVariables,
      })

      const evaluatedCondition = replaceValidReferences(condition, (match) => {
        const resolved = this.resolver.resolveSingleReference(ctx, '', match, scope)
        logger.info('Resolved variable reference in loop condition', {
          reference: match,
          resolvedValue: resolved,
          resolvedType: typeof resolved,
        })
        if (resolved !== undefined) {
          if (typeof resolved === 'boolean' || typeof resolved === 'number') {
            return String(resolved)
          }
          if (typeof resolved === 'string') {
            const lower = resolved.toLowerCase().trim()
            if (lower === 'true' || lower === 'false') {
              return lower
            }
            return `"${resolved}"`
          }
          return JSON.stringify(resolved)
        }
        return match
      })

      const requestId = generateRequestId()
      const code = `return Boolean(${evaluatedCondition})`

      const vmResult = await executeInIsolatedVM({
        code,
        params: {},
        envVars: {},
        contextVariables: {},
        timeoutMs: LOOP_CONDITION_TIMEOUT_MS,
        requestId,
        ownerKey: `user:${ctx.userId}`,
        ownerWeight: 1,
      })

      if (vmResult.error) {
        logger.error('Failed to evaluate loop condition', {
          condition,
          evaluatedCondition,
          error: vmResult.error,
        })
        return false
      }

      const result = Boolean(vmResult.result)

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
    return resolveArrayInput(ctx, items, this.resolver)
  }
}
