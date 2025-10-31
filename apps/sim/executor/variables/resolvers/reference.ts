import type { ExecutionContext } from '@/executor/types'
import type { ExecutionState, LoopScope } from '../../execution/state'
export interface ResolutionContext {
  executionContext: ExecutionContext
  executionState: ExecutionState
  currentNodeId: string
  loopScope?: LoopScope
}
export interface Resolver {
  canResolve(reference: string): boolean
  resolve(reference: string, context: ResolutionContext): any
}
