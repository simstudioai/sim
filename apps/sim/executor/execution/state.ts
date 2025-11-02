import type { NormalizedBlockOutput } from '@/executor/types'
export interface LoopScope {
  iteration: number
  currentIterationOutputs: Map<string, NormalizedBlockOutput>
  allIterationOutputs: NormalizedBlockOutput[][]
  maxIterations?: number
  item?: any
  items?: any[]
  condition?: string
  skipFirstConditionCheck?: boolean
}

export interface ParallelScope {
  parallelId: string
  totalBranches: number
  branchOutputs: Map<number, NormalizedBlockOutput[]>
  completedCount: number
  totalExpectedNodes: number
}

export class ExecutionState {
  // Shared references with ExecutionContext for single source of truth
  readonly blockStates: Map<
    string,
    { output: NormalizedBlockOutput; executed: boolean; executionTime: number }
  >
  readonly executedBlocks: Set<string>
  readonly loopScopes = new Map<string, LoopScope>()
  readonly parallelScopes = new Map<string, ParallelScope>()

  constructor(
    blockStates: Map<
      string,
      { output: NormalizedBlockOutput; executed: boolean; executionTime: number }
    >,
    executedBlocks: Set<string>
  ) {
    this.blockStates = blockStates
    this.executedBlocks = executedBlocks
  }

  getBlockOutput(blockId: string): NormalizedBlockOutput | undefined {
    return this.blockStates.get(blockId)?.output
  }

  setBlockOutput(blockId: string, output: NormalizedBlockOutput): void {
    this.blockStates.set(blockId, { output, executed: true, executionTime: 0 })
    this.executedBlocks.add(blockId)
  }

  hasExecuted(blockId: string): boolean {
    return this.executedBlocks.has(blockId)
  }

  getLoopScope(loopId: string): LoopScope | undefined {
    return this.loopScopes.get(loopId)
  }

  setLoopScope(loopId: string, scope: LoopScope): void {
    this.loopScopes.set(loopId, scope)
  }

  getParallelScope(parallelId: string): ParallelScope | undefined {
    return this.parallelScopes.get(parallelId)
  }

  setParallelScope(parallelId: string, scope: ParallelScope): void {
    this.parallelScopes.set(parallelId, scope)
  }
}
