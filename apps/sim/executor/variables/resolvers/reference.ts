import type { ExecutionState, LoopScope } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
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

/**
 * Navigate through nested object properties using a path array.
 * Supports dot notation and array indices.
 *
 * @example
 * navigatePath({a: {b: {c: 1}}}, ['a', 'b', 'c']) => 1
 * navigatePath({items: [{name: 'test'}]}, ['items', '0', 'name']) => 'test'
 */
export function navigatePath(obj: any, path: string[]): any {
  let current = obj
  for (const part of path) {
    if (current === null || current === undefined) {
      return undefined
    }

    // Handle array indexing like "items[0]" or just numeric indices
    const arrayMatch = part.match(/^([^[]+)\[(\d+)\](.*)$/)
    if (arrayMatch) {
      // Handle complex array access like "items[0]"
      const [, prop, index] = arrayMatch
      current = current[prop]
      if (current === undefined || current === null) {
        return undefined
      }
      const idx = Number.parseInt(index, 10)
      current = Array.isArray(current) ? current[idx] : undefined
    } else if (/^\d+$/.test(part)) {
      // Handle plain numeric index
      const index = Number.parseInt(part, 10)
      current = Array.isArray(current) ? current[index] : undefined
    } else {
      // Handle regular property access
      current = current[part]
    }
  }
  return current
}
