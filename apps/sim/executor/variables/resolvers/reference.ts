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

    const arrayMatch = part.match(/^([^[]+)(\[.+)$/)
    if (arrayMatch) {
      const [, prop, bracketsPart] = arrayMatch
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[prop]
          : undefined
      if (current === undefined || current === null) {
        return undefined
      }

      const indices = bracketsPart.match(/\[(\d+)\]/g)
      if (indices) {
        for (const indexMatch of indices) {
          if (current === null || current === undefined) {
            return undefined
          }
          const idx = Number.parseInt(indexMatch.slice(1, -1), 10)
          current = Array.isArray(current) ? current[idx] : undefined
        }
      }
    } else if (/^\d+$/.test(part)) {
      const index = Number.parseInt(part, 10)
      current = Array.isArray(current) ? current[index] : undefined
    } else {
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[part]
          : undefined
    }
  }
  return current
}
