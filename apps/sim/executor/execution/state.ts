import type { BlockStateController } from '@/executor/execution/types'
import type { BlockState, NormalizedBlockOutput } from '@/executor/types'

function normalizeLookupId(id: string): string {
  return id.replace(/₍\d+₎/gu, '').replace(/_loop\d+/g, '')
}
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

export class ExecutionState implements BlockStateController {
  private readonly blockStates: Map<string, BlockState>
  private readonly executedBlocks: Set<string>

  constructor(blockStates?: Map<string, BlockState>, executedBlocks?: Set<string>) {
    this.blockStates = blockStates ?? new Map()
    this.executedBlocks = executedBlocks ?? new Set()
  }

  getBlockStates(): ReadonlyMap<string, BlockState> {
    return this.blockStates
  }

  getExecutedBlocks(): ReadonlySet<string> {
    return this.executedBlocks
  }

  getBlockOutput(blockId: string, currentNodeId?: string): NormalizedBlockOutput | undefined {
    const direct = this.blockStates.get(blockId)?.output
    if (direct !== undefined) {
      return direct
    }

    const normalizedId = normalizeLookupId(blockId)
    if (normalizedId !== blockId) {
      return undefined
    }

    if (currentNodeId) {
      const currentSuffix = currentNodeId.replace(normalizedId, '').match(/₍\d+₎/g)?.[0] ?? ''
      const loopSuffix = currentNodeId.match(/_loop\d+/)?.[0] ?? ''
      const withSuffix = `${blockId}${currentSuffix}${loopSuffix}`
      const suffixedOutput = this.blockStates.get(withSuffix)?.output
      if (suffixedOutput !== undefined) {
        return suffixedOutput
      }
    }

    for (const [storedId, state] of this.blockStates.entries()) {
      if (normalizeLookupId(storedId) === blockId) {
        return state.output
      }
    }

    return undefined
  }

  setBlockOutput(blockId: string, output: NormalizedBlockOutput, executionTime = 0): void {
    this.blockStates.set(blockId, { output, executed: true, executionTime })
    this.executedBlocks.add(blockId)
  }

  setBlockState(blockId: string, state: BlockState): void {
    this.blockStates.set(blockId, state)
    if (state.executed) {
      this.executedBlocks.add(blockId)
    } else {
      this.executedBlocks.delete(blockId)
    }
  }

  deleteBlockState(blockId: string): void {
    this.blockStates.delete(blockId)
    this.executedBlocks.delete(blockId)
  }

  unmarkExecuted(blockId: string): void {
    this.executedBlocks.delete(blockId)
  }

  hasExecuted(blockId: string): boolean {
    return this.executedBlocks.has(blockId)
  }
}
