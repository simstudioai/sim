/**
 * SubflowManager
 * 
 * Manages loop and parallel execution logic.
 * Handles iteration tracking, backwards edges, and result aggregation.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import type { DAG } from './dag-builder'
import type { ExecutionState, LoopScope, ParallelScope } from './execution-state'
import type { VariableResolver } from './variable-resolver'

const logger = createLogger('SubflowManager')

export class SubflowManager {
  constructor(
    private workflow: SerializedWorkflow,
    private dag: DAG,
    private state: ExecutionState,
    private resolver: VariableResolver
  ) {}

  initializeLoopScope(loopId: string, context: ExecutionContext): LoopScope {
    const loopConfig = this.dag.loopConfigs.get(loopId) as any
    if (!loopConfig) {
      throw new Error(`Loop config not found: ${loopId}`)
    }

    logger.debug('Raw loop config', {
      loopId,
      loopConfig: JSON.stringify(loopConfig)
    })

    const scope: LoopScope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
    }

    const loopType = loopConfig.loopType

    if (loopType === 'for') {
      scope.maxIterations = loopConfig.iterations || 1
      scope.condition = `<loop.index> < ${scope.maxIterations}`
    } else if (loopType === 'forEach') {
      const items = this.resolveForEachItems(loopConfig.forEachItems, context)
      scope.items = items
      scope.maxIterations = items.length
      scope.item = items[0]
      scope.condition = `<loop.index> < ${scope.maxIterations}`
      
      logger.debug('Initialized forEach loop', {
        loopId,
        itemsCount: items.length,
        firstItem: items[0],
      })
    } else if (loopType === 'while') {
      scope.condition = loopConfig.whileCondition
    } else if (loopType === 'doWhile' || loopType === 'do-while') {
      if (loopConfig.doWhileCondition) {
        scope.condition = loopConfig.doWhileCondition
      } else {
        scope.maxIterations = loopConfig.iterations || 1
        scope.condition = `<loop.index> < ${scope.maxIterations}`
      }
      scope.skipFirstConditionCheck = true
    }

    logger.debug('Initialized loop scope', {
      loopId,
      loopType,
      condition: scope.condition,
      maxIterations: scope.maxIterations,
      skipFirstConditionCheck: scope.skipFirstConditionCheck
    })

    this.state.setLoopScope(loopId, scope)
    return scope
  }

  initializeParallelScope(parallelId: string, totalBranches: number): ParallelScope {
    const scope: ParallelScope = {
      parallelId,
      totalBranches,
      branchOutputs: new Map(),
    }

    this.state.setParallelScope(parallelId, scope)
    return scope
  }

  handleLoopIteration(
    loopId: string,
    lastNodeId: string,
    output: NormalizedBlockOutput,
    context: ExecutionContext
  ): { shouldContinue: boolean; nextNodeId?: string } {
    const scope = this.state.getLoopScope(loopId)
    if (!scope) {
      return { shouldContinue: false }
    }

    const baseId = this.extractBaseId(lastNodeId)
    scope.currentIterationOutputs.set(baseId, output)

    const loopConfig = this.dag.loopConfigs.get(loopId)
    if (!loopConfig) {
      return { shouldContinue: false }
    }

    const isLastNodeInLoop = loopConfig.nodes[loopConfig.nodes.length - 1] === lastNodeId

    if (!isLastNodeInLoop) {
      return { shouldContinue: true }
    }

    const iterationResults: NormalizedBlockOutput[] = []
    for (const blockOutput of scope.currentIterationOutputs.values()) {
      iterationResults.push(blockOutput)
    }

    if (iterationResults.length > 0) {
      scope.allIterationOutputs.push(iterationResults)
    }

    scope.currentIterationOutputs.clear()

    const shouldContinue = this.shouldLoopContinue(loopId, scope, context)

    if (shouldContinue) {
      const firstNodeId = loopConfig.nodes[0]
      return { shouldContinue: true, nextNodeId: firstNodeId }
    }

    this.aggregateLoopResults(loopId, scope)
    return { shouldContinue: false }
  }

  handleParallelBranch(
    parallelId: string,
    nodeId: string,
    output: NormalizedBlockOutput
  ): boolean {
    const scope = this.state.getParallelScope(parallelId)
    if (!scope) {
      return false
    }

    const branchIndex = this.extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return false
    }

    scope.branchOutputs.set(branchIndex, output)

    const allBranchesComplete = scope.branchOutputs.size === scope.totalBranches

    if (allBranchesComplete) {
      this.aggregateParallelResults(parallelId, scope)
    }

    return allBranchesComplete
  }

  evaluateCondition(scope: LoopScope, context: ExecutionContext, nextIteration?: number): boolean {
    if (!scope.condition) {
      return false
    }

    if (nextIteration !== undefined) {
      const currentIteration = scope.iteration
      scope.iteration = nextIteration
      const result = this.evaluateWhileCondition(scope.condition, scope, context)
      scope.iteration = currentIteration
      return result
    }

    return this.evaluateWhileCondition(scope.condition, scope, context)
  }

  shouldExecuteLoopNode(nodeId: string, loopId: string, context: ExecutionContext): boolean {
    return true
  }

  private shouldLoopContinue(loopId: string, scope: LoopScope, context: ExecutionContext): boolean {
    const isFirstIteration = scope.iteration === 0
    const shouldSkipFirstCheck = scope.skipFirstConditionCheck && isFirstIteration

    if (!shouldSkipFirstCheck) {
      if (!this.evaluateCondition(scope, context, scope.iteration + 1)) {
        logger.debug('Loop condition false for next iteration', { iteration: scope.iteration + 1 })
        return false
      }
    }

    scope.iteration++
    
    if (scope.items && scope.iteration < scope.items.length) {
      scope.item = scope.items[scope.iteration]
    }

    return true
  }

  private evaluateWhileCondition(condition: string, scope: LoopScope, context: ExecutionContext): boolean {
    if (!condition) {
      return false
    }

    try {
      const referencePattern = /<([^>]+)>/g
      let evaluatedCondition = condition
      const replacements: Record<string, string> = {}

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
      logger.debug('Evaluated while condition', { 
        condition, 
        replacements,
        evaluatedCondition, 
        result, 
        iteration: scope.iteration 
      })
      return result
    } catch (error) {
      logger.error('Failed to evaluate while condition', { condition, error })
      return false
    }
  }

  private aggregateLoopResults(loopId: string, scope: LoopScope): void {
    const results = scope.allIterationOutputs

    this.state.setBlockOutput(loopId, {
      results,
    })

    logger.debug('Aggregated loop results', {
      loopId,
      totalIterations: scope.allIterationOutputs.length,
    })
  }

  private aggregateParallelResults(parallelId: string, scope: ParallelScope): void {
    const results: NormalizedBlockOutput[] = []

    for (let i = 0; i < scope.totalBranches; i++) {
      const branchOutput = scope.branchOutputs.get(i)
      if (branchOutput) {
        results.push(branchOutput)
      }
    }

    this.state.setBlockOutput(parallelId, {
      results,
    })

    logger.debug('Aggregated parallel results', {
      parallelId,
      totalBranches: scope.totalBranches,
    })
  }

  private resolveForEachItems(items: any, context: ExecutionContext): any[] {
    if (Array.isArray(items)) {
      return items
    }

    if (typeof items === 'object' && items !== null) {
      return Object.entries(items)
    }

    if (typeof items === 'string') {
      if (items.startsWith('<') && items.endsWith('>')) {
        const resolved = this.resolver.resolveSingleReference(items, '', context)
        return Array.isArray(resolved) ? resolved : []
      }

      const normalized = items.replace(/'/g, '"')
      return JSON.parse(normalized)
    }

    return []
  }

  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }

  private extractBranchIndex(nodeId: string): number | null {
    const match = nodeId.match(/₍(\d+)₎$/)
    return match ? parseInt(match[1], 10) : null
  }
}

