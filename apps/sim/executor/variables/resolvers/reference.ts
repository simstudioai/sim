import {
  materializeLargeValueRefSync,
  materializeLargeValueRefSyncOrThrow,
} from '@/lib/execution/payloads/cache'
import {
  isLargeArrayManifest,
  type LargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import { assertNoLargeValueRefs, isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import type { ExecutionState, LoopScope } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'

export interface PathNavigationExecutionContext {
  workflowId: string
  workspaceId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
  metadata?: { requestId?: string }
  base64MaxBytes?: number
}

export interface PathNavigationContext {
  executionContext: PathNavigationExecutionContext
  allowLargeValueRefs?: boolean
}

export interface ResolutionContext {
  executionContext: ExecutionContext
  executionState: ExecutionState
  currentNodeId: string
  loopScope?: LoopScope
  allowLargeValueRefs?: boolean
}

export interface Resolver {
  canResolve(reference: string): boolean
  resolve(reference: string, context: ResolutionContext): any
  resolveAsync?(reference: string, context: ResolutionContext): Promise<any>
}

export type AsyncPathNavigator = (
  obj: any,
  path: string[],
  context: PathNavigationContext
) => Promise<any>

/**
 * Sentinel value indicating a reference was resolved to a known block
 * that produced no output (e.g., the block exists in the workflow but
 * didn't execute on this path). Distinct from `undefined`, which means
 * the reference couldn't be matched to any block at all.
 */
export const RESOLVED_EMPTY = Symbol('RESOLVED_EMPTY')

export function splitLeadingBracketPath(part: string): { property: string; pathParts: string[] } {
  const bracketMatch = part.match(/^([^[]+)((?:\[\d+\])+)$/)
  if (!bracketMatch) {
    return { property: part, pathParts: [] }
  }

  const indices = bracketMatch[2].match(/\[(\d+)\]/g) ?? []
  return {
    property: bracketMatch[1],
    pathParts: indices.map((indexMatch) => indexMatch.slice(1, -1)),
  }
}

function readManifestIndexSync(
  manifest: LargeArrayManifest,
  index: number,
  executionContext?: ExecutionContext
): unknown {
  if (!Number.isInteger(index) || index < 0 || index >= manifest.totalCount) {
    return undefined
  }

  let offset = 0
  for (const chunk of manifest.chunks) {
    const nextOffset = offset + chunk.count
    if (index < nextOffset) {
      const materialized = materializeLargeValueRefSync(chunk.ref, executionContext)
      if (materialized === undefined) {
        return undefined
      }
      if (!Array.isArray(materialized)) {
        throw new Error('Large array manifest chunk must materialize to an array.')
      }
      if (materialized.length !== chunk.count) {
        throw new Error('Large array manifest chunk count does not match materialized data.')
      }
      return materialized[index - offset]
    }
    offset = nextOffset
  }

  return undefined
}

function navigateManifestMetadataOrIndexSync(
  manifest: LargeArrayManifest,
  part: string,
  executionContext?: ExecutionContext
): unknown {
  if (part === 'length' || part === 'totalCount') {
    return manifest.totalCount
  }
  if (part === 'chunkCount' || part === 'byteSize' || part === 'preview') {
    return manifest[part]
  }
  if (/^\d+$/.test(part)) {
    return readManifestIndexSync(manifest, Number.parseInt(part, 10), executionContext)
  }
  return undefined
}

/**
 * Navigate through nested object properties using a path array.
 * Supports dot notation and array indices.
 *
 * @example
 * navigatePath({a: {b: {c: 1}}}, ['a', 'b', 'c']) => 1
 * navigatePath({items: [{name: 'test'}]}, ['items', '0', 'name']) => 'test'
 */
export function navigatePath(
  obj: any,
  path: string[],
  options: { allowLargeValueRefs?: boolean; executionContext?: ExecutionContext } = {}
): any {
  let current = obj
  for (const part of path) {
    if (isLargeValueRef(current)) {
      current = materializeLargeValueRefSyncOrThrow(current, options.executionContext)
    }

    if (current === null || current === undefined) {
      return undefined
    }

    if (isLargeArrayManifest(current)) {
      current = navigateManifestMetadataOrIndexSync(current, part, options.executionContext)
      continue
    }

    const arrayMatch = part.match(/^([^[]+)(\[.+)$/)
    if (arrayMatch) {
      const [, prop, bracketsPart] = arrayMatch
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[prop]
          : undefined
      if (isLargeValueRef(current)) {
        current = materializeLargeValueRefSyncOrThrow(current, options.executionContext)
      }
      if (current === undefined || current === null) {
        return undefined
      }

      const indices = bracketsPart.match(/\[(\d+)\]/g)
      if (indices) {
        for (const indexMatch of indices) {
          if (current === null || current === undefined) {
            return undefined
          }
          if (isLargeValueRef(current)) {
            current = materializeLargeValueRefSyncOrThrow(current, options.executionContext)
          }
          if (isLargeArrayManifest(current)) {
            current = navigateManifestMetadataOrIndexSync(
              current,
              indexMatch.slice(1, -1),
              options.executionContext
            )
            continue
          }
          const idx = Number.parseInt(indexMatch.slice(1, -1), 10)
          current = Array.isArray(current) ? current[idx] : undefined
        }
      }
    } else if (/^\d+$/.test(part)) {
      const index = Number.parseInt(part, 10)
      current = isLargeArrayManifest(current)
        ? readManifestIndexSync(current, index, options.executionContext)
        : Array.isArray(current)
          ? current[index]
          : undefined
    } else {
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[part]
          : undefined
    }
  }
  if (!options.allowLargeValueRefs) {
    assertNoLargeValueRefs(current)
  }
  return current
}
