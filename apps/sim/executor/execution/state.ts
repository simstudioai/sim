import type { NormalizedBlockOutput } from '@/executor/types'

function normalizeLookupId(id: string): string {
  return id
    .replace(/₍\d+₎/gu, '')
    .replace(/_loop\d+/g, '')
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

export class ExecutionState {
  // Shared references with ExecutionContext for single source of truth
  readonly blockStates: Map<
    string,
    { output: NormalizedBlockOutput; executed: boolean; executionTime: number }
  >
  readonly executedBlocks: Set<string>

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

  getBlockOutput(blockId: string, currentNodeId?: string): NormalizedBlockOutput | undefined {
    // First try direct lookup
    const direct = this.blockStates.get(blockId)?.output
    if (direct !== undefined) {
      return direct
    }

    // If the blockId is already suffixed, no fallback needed
    const normalizedId = normalizeLookupId(blockId)
    if (normalizedId !== blockId) {
      return undefined
    }

    // blockId has no suffix - need to find the right suffixed version
    // If we're in a parallel/loop context (currentNodeId has suffix), match that suffix
    if (currentNodeId) {
      // Extract suffix from current node
      const currentSuffix = currentNodeId.replace(normalizedId, '').match(/₍\d+₎/g)?.[0] || ''
      const loopSuffix = currentNodeId.match(/_loop\d+/)?.[0] || ''
      
      // Try with matching suffix
      const withSuffix = `${blockId}${currentSuffix}${loopSuffix}`
      const suffixedOutput = this.blockStates.get(withSuffix)?.output
      if (suffixedOutput !== undefined) {
        return suffixedOutput
      }
    }

    // Fall back to first match with same base ID
    for (const [storedId, state] of this.blockStates.entries()) {
      if (normalizeLookupId(storedId) === blockId) {
        return state.output
      }
    }

    return undefined
  }

  setBlockOutput(blockId: string, output: NormalizedBlockOutput): void {
    this.blockStates.set(blockId, { output, executed: true, executionTime: 0 })
    this.executedBlocks.add(blockId)
  }

  hasExecuted(blockId: string): boolean {
    return this.executedBlocks.has(blockId)
  }
}
