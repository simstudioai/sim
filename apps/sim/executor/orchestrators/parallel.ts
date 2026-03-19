import { createLogger } from '@sim/logger'
import { DEFAULTS } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { ParallelScope } from '@/executor/execution/state'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import {
  type ExecutionContext,
  getNextExecutionOrder,
  type NormalizedBlockOutput,
} from '@/executor/types'
import type { ParallelConfigWithNodes } from '@/executor/types/parallel'
import { buildContainerIterationContext } from '@/executor/utils/iteration-context'
import { ParallelExpander } from '@/executor/utils/parallel-expansion'
import {
  addSubflowErrorLog,
  emitEmptySubflowEvents,
  extractBranchIndex,
  resolveArrayInput,
  validateMaxCount,
} from '@/executor/utils/subflow-utils'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedParallel } from '@/serializer/types'

const logger = createLogger('ParallelOrchestrator')

export interface ParallelBranchMetadata {
  branchIndex: number
  branchTotal: number
  distributionItem?: any
  parallelId: string
}

export interface ParallelAggregationResult {
  allBranchesComplete: boolean
  results?: NormalizedBlockOutput[][]
  completedBranches?: number
  totalBranches?: number
}

export class ParallelOrchestrator {
  private expander = new ParallelExpander()

  constructor(
    private dag: DAG,
    private state: BlockStateWriter,
    private resolver: VariableResolver | null = null,
    private contextExtensions: ContextExtensions | null = null
  ) {}

  async initializeParallelScope(
    ctx: ExecutionContext,
    parallelId: string,
    terminalNodesCount = 1
  ): Promise<ParallelScope> {
    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    if (!parallelConfig) {
      throw new Error(`Parallel config not found: ${parallelId}`)
    }

    if (terminalNodesCount === 0 || parallelConfig.nodes.length === 0) {
      const errorMessage =
        'Parallel has no executable blocks inside. Add or enable at least one block in the parallel.'
      logger.error(errorMessage, { parallelId })
      await this.addParallelErrorLog(ctx, parallelId, errorMessage, {})
      this.setErrorScope(ctx, parallelId, errorMessage)
      throw new Error(errorMessage)
    }

    let items: any[] | undefined
    let branchCount: number
    let isEmpty = false

    try {
      const resolved = this.resolveBranchCount(ctx, parallelConfig, parallelId)
      branchCount = resolved.branchCount
      items = resolved.items
      isEmpty = resolved.isEmpty ?? false
    } catch (error) {
      const baseErrorMessage = error instanceof Error ? error.message : String(error)
      const errorMessage = baseErrorMessage.startsWith('Parallel collection distribution is empty')
        ? baseErrorMessage
        : `Parallel Items did not resolve: ${baseErrorMessage}`
      logger.error(errorMessage, { parallelId, distribution: parallelConfig.distribution })
      await this.addParallelErrorLog(ctx, parallelId, errorMessage, {
        distribution: parallelConfig.distribution,
      })
      this.setErrorScope(ctx, parallelId, errorMessage)
      throw new Error(errorMessage)
    }

    const branchError = validateMaxCount(
      branchCount,
      DEFAULTS.MAX_PARALLEL_BRANCHES,
      'Parallel branch count'
    )
    if (branchError) {
      logger.error(branchError, { parallelId, branchCount })
      await this.addParallelErrorLog(ctx, parallelId, branchError, {
        distribution: parallelConfig.distribution,
        branchCount,
      })
      this.setErrorScope(ctx, parallelId, branchError)
      throw new Error(branchError)
    }

    if (isEmpty || branchCount === 0) {
      const scope: ParallelScope = {
        parallelId,
        totalBranches: 0,
        branchOutputs: new Map(),
        completedCount: 0,
        totalExpectedNodes: 0,
        items: [],
        isEmpty: true,
      }

      if (!ctx.parallelExecutions) {
        ctx.parallelExecutions = new Map()
      }
      ctx.parallelExecutions.set(parallelId, scope)

      this.state.setBlockOutput(parallelId, { results: [] })

      await emitEmptySubflowEvents(ctx, parallelId, 'parallel', this.contextExtensions)

      logger.info('Parallel scope initialized with empty distribution, skipping body', {
        parallelId,
        branchCount: 0,
      })

      return scope
    }

    const { entryNodes, clonedSubflows } = this.expander.expandParallel(
      this.dag,
      parallelId,
      branchCount,
      items
    )

    // Register cloned subflows in the parent map so iteration context resolves correctly.
    // Build a per-branch clone map so nested clones point to the cloned parent, not the original.
    if (clonedSubflows.length > 0 && ctx.subflowParentMap) {
      const branchCloneMaps = new Map<number, Map<string, string>>()
      for (const clone of clonedSubflows) {
        let map = branchCloneMaps.get(clone.outerBranchIndex)
        if (!map) {
          map = new Map()
          branchCloneMaps.set(clone.outerBranchIndex, map)
        }
        map.set(clone.originalId, clone.clonedId)
      }

      for (const clone of clonedSubflows) {
        const originalEntry = ctx.subflowParentMap.get(clone.originalId)
        if (originalEntry) {
          const cloneMap = branchCloneMaps.get(clone.outerBranchIndex)
          const clonedParentId = cloneMap?.get(originalEntry.parentId)
          if (clonedParentId) {
            // Parent was also cloned — this is the original (branch 0) inside the cloned parent
            ctx.subflowParentMap.set(clone.clonedId, {
              parentId: clonedParentId,
              parentType: originalEntry.parentType,
              branchIndex: 0,
            })
          } else {
            // Parent was not cloned — direct child of the expanding parallel
            ctx.subflowParentMap.set(clone.clonedId, {
              parentId: parallelId,
              parentType: 'parallel',
              branchIndex: clone.outerBranchIndex,
            })
          }
        } else {
          // Not in parent map — direct child of the expanding parallel
          ctx.subflowParentMap.set(clone.clonedId, {
            parentId: parallelId,
            parentType: 'parallel',
            branchIndex: clone.outerBranchIndex,
          })
        }
      }
    }

    const scope: ParallelScope = {
      parallelId,
      totalBranches: branchCount,
      branchOutputs: new Map(),
      completedCount: 0,
      totalExpectedNodes: branchCount * terminalNodesCount,
      items,
    }

    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)

    const newEntryNodes = entryNodes.filter((nodeId) => !nodeId.endsWith('__branch-0'))
    if (newEntryNodes.length > 0) {
      if (!ctx.pendingDynamicNodes) {
        ctx.pendingDynamicNodes = []
      }
      ctx.pendingDynamicNodes.push(...newEntryNodes)
    }

    logger.info('Parallel scope initialized', {
      parallelId,
      branchCount,
      entryNodeCount: entryNodes.length,
      newEntryNodes: newEntryNodes.length,
    })

    return scope
  }

  private resolveBranchCount(
    ctx: ExecutionContext,
    config: SerializedParallel,
    parallelId: string
  ): { branchCount: number; items?: any[]; isEmpty?: boolean } {
    if (config.parallelType === 'count') {
      return { branchCount: config.count ?? 1 }
    }

    const items = this.resolveDistributionItems(ctx, config)
    if (items.length === 0) {
      logger.info('Parallel has empty distribution, skipping parallel body', { parallelId })
      return { branchCount: 0, items: [], isEmpty: true }
    }

    return { branchCount: items.length, items }
  }

  private async addParallelErrorLog(
    ctx: ExecutionContext,
    parallelId: string,
    errorMessage: string,
    inputData?: any
  ): Promise<void> {
    await addSubflowErrorLog(
      ctx,
      parallelId,
      'parallel',
      errorMessage,
      inputData || {},
      this.contextExtensions
    )
  }

  private setErrorScope(ctx: ExecutionContext, parallelId: string, errorMessage: string): void {
    const scope: ParallelScope = {
      parallelId,
      totalBranches: 0,
      branchOutputs: new Map(),
      completedCount: 0,
      totalExpectedNodes: 0,
      items: [],
      validationError: errorMessage,
    }
    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)
  }

  private resolveDistributionItems(ctx: ExecutionContext, config: SerializedParallel): any[] {
    if (
      config.distribution === undefined ||
      config.distribution === null ||
      config.distribution === ''
    ) {
      throw new Error(
        'Parallel collection distribution is empty. Provide an array or a reference that resolves to a collection.'
      )
    }
    return resolveArrayInput(ctx, config.distribution, this.resolver)
  }

  handleParallelBranchCompletion(
    ctx: ExecutionContext,
    parallelId: string,
    nodeId: string,
    output: NormalizedBlockOutput
  ): boolean {
    const scope = ctx.parallelExecutions?.get(parallelId)
    if (!scope) {
      logger.warn('Parallel scope not found for branch completion', { parallelId, nodeId })
      return false
    }

    const branchIndex = extractBranchIndex(nodeId)
    if (branchIndex === null) {
      logger.warn('Could not extract branch index from node ID', { nodeId })
      return false
    }

    if (!scope.branchOutputs.has(branchIndex)) {
      scope.branchOutputs.set(branchIndex, [])
    }
    scope.branchOutputs.get(branchIndex)!.push(output)
    scope.completedCount++

    const allComplete = scope.completedCount >= scope.totalExpectedNodes
    return allComplete
  }

  async aggregateParallelResults(
    ctx: ExecutionContext,
    parallelId: string
  ): Promise<ParallelAggregationResult> {
    const scope = ctx.parallelExecutions?.get(parallelId)
    if (!scope) {
      logger.error('Parallel scope not found for aggregation', { parallelId })
      return { allBranchesComplete: false }
    }

    const results: NormalizedBlockOutput[][] = []
    for (let i = 0; i < scope.totalBranches; i++) {
      const branchOutputs = scope.branchOutputs.get(i)
      if (!branchOutputs) {
        logger.warn('Missing branch output during parallel aggregation', { parallelId, branch: i })
      }
      results.push(branchOutputs ?? [])
    }
    const output = { results }
    this.state.setBlockOutput(parallelId, output)

    // Emit onBlockComplete for the parallel container so the UI can track it.
    // When this parallel is nested inside a parent subflow (parallel or loop), emit
    // iteration context so the terminal can group this event under the parent container.
    if (this.contextExtensions?.onBlockComplete) {
      const now = new Date().toISOString()
      const iterationContext = buildContainerIterationContext(ctx, parallelId)

      try {
        await this.contextExtensions.onBlockComplete(
          parallelId,
          'Parallel',
          'parallel',
          {
            output,
            executionTime: 0,
            startedAt: now,
            executionOrder: getNextExecutionOrder(ctx),
            endedAt: now,
          },
          iterationContext
        )
      } catch (error) {
        logger.warn('Parallel completion callback failed', {
          parallelId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      allBranchesComplete: true,
      results,
      completedBranches: scope.totalBranches,
      totalBranches: scope.totalBranches,
    }
  }
  extractBranchMetadata(nodeId: string): ParallelBranchMetadata | null {
    const node = this.dag.nodes.get(nodeId)
    if (!node?.metadata.isParallelBranch) {
      return null
    }

    const branchIndex = extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return null
    }

    const parallelId = node.metadata.parallelId
    if (!parallelId) {
      return null
    }

    return {
      branchIndex,
      branchTotal: node.metadata.branchTotal ?? 1,
      distributionItem: node.metadata.distributionItem,
      parallelId,
    }
  }

  getParallelScope(ctx: ExecutionContext, parallelId: string): ParallelScope | undefined {
    return ctx.parallelExecutions?.get(parallelId)
  }

  findParallelIdForNode(baseNodeId: string): string | undefined {
    for (const [parallelId, config] of this.dag.parallelConfigs) {
      const parallelConfig = config as ParallelConfigWithNodes
      if (parallelConfig.nodes?.includes(baseNodeId)) {
        return parallelId
      }
    }
    return undefined
  }
}
