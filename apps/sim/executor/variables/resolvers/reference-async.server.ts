import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  assertNoLargeValueRefs,
  getLargeValueMaterializationError,
  isLargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import { hydrateUserFileWithBase64 } from '@/lib/uploads/utils/user-file-base64.server'
import type { ResolutionContext } from '@/executor/variables/resolvers/reference'

async function materializeLargeValueRefOrThrow(
  value: unknown,
  context: ResolutionContext
): Promise<unknown> {
  if (!isLargeValueRef(value)) {
    return value
  }
  const materialized = await materializeLargeValueRef(value, {
    workspaceId: context.executionContext.workspaceId,
    workflowId: context.executionContext.workflowId,
    executionId: context.executionContext.executionId,
    largeValueExecutionIds: context.executionContext.largeValueExecutionIds,
    allowLargeValueWorkflowScope: context.executionContext.allowLargeValueWorkflowScope,
    userId: context.executionContext.userId,
  })
  if (materialized === undefined) {
    throw getLargeValueMaterializationError(value)
  }
  return materialized
}

async function hydrateExplicitBase64(
  file: unknown,
  context: ResolutionContext
): Promise<string | undefined> {
  if (!isUserFileWithMetadata(file)) {
    return undefined
  }
  const hydrated = await hydrateUserFileWithBase64(file, {
    requestId: context.executionContext.metadata.requestId,
    workspaceId: context.executionContext.workspaceId,
    workflowId: context.executionContext.workflowId,
    executionId: context.executionContext.executionId,
    largeValueExecutionIds: context.executionContext.largeValueExecutionIds,
    allowLargeValueWorkflowScope: context.executionContext.allowLargeValueWorkflowScope,
    userId: context.executionContext.userId,
    maxBytes: context.executionContext.base64MaxBytes,
  })
  if (!hydrated.base64) {
    throw new Error(
      `Base64 content for ${file.name} is unavailable or exceeds the configured inline limit.`
    )
  }
  return hydrated.base64
}

/**
 * Server-side path navigation used during execution. It can hydrate persisted
 * large values and UserFile.base64 only when the requested path explicitly asks
 * for base64.
 */
export async function navigatePathAsync(
  obj: any,
  path: string[],
  context: ResolutionContext
): Promise<any> {
  let current = obj
  for (const part of path) {
    current = await materializeLargeValueRefOrThrow(current, context)

    if (current === null || current === undefined) {
      return undefined
    }

    if (part === 'base64') {
      const base64 = await hydrateExplicitBase64(current, context)
      if (base64 !== undefined) {
        current = base64
        continue
      }
    }

    const arrayMatch = part.match(/^([^[]+)(\[.+)$/)
    if (arrayMatch) {
      const [, prop, bracketsPart] = arrayMatch
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[prop]
          : undefined
      current = await materializeLargeValueRefOrThrow(current, context)
      if (current === undefined || current === null) {
        return undefined
      }

      const indices = bracketsPart.match(/\[(\d+)\]/g)
      if (indices) {
        for (const indexMatch of indices) {
          current = await materializeLargeValueRefOrThrow(current, context)
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
  if (!context.allowLargeValueRefs) {
    assertNoLargeValueRefs(current)
  }
  return current
}
