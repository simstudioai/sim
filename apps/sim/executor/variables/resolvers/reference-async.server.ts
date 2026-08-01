import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { recordMaterializedAccessKeys } from '@/lib/execution/payloads/access-keys'
import {
  isLargeArrayManifest,
  type LargeArrayManifest,
  readLargeArrayManifestSlice,
} from '@/lib/execution/payloads/large-array-manifest'
import {
  assertNoLargeValueRefs,
  getLargeValueMaterializationError,
  isLargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import { hydrateUserFileWithBase64 } from '@/lib/uploads/utils/user-file-base64.server'
import type { PathNavigationContext } from '@/executor/variables/resolvers/reference'

interface MaterializedNavigationValue {
  value: unknown
  context: PathNavigationContext
}

function withLocalLargeValueExecutionIds(
  context: PathNavigationContext,
  materializedValue: unknown
): PathNavigationContext {
  if (!context.executionContext) {
    return context
  }
  recordMaterializedAccessKeys(context.executionContext, materializedValue)
  return {
    ...context,
    executionContext: {
      ...context.executionContext,
      largeValueKeys: context.executionContext.largeValueKeys,
      fileKeys: context.executionContext.fileKeys,
    },
  }
}

async function materializeLargeValueRefOrThrow(
  value: unknown,
  context: PathNavigationContext
): Promise<MaterializedNavigationValue> {
  if (!isLargeValueRef(value)) {
    return { value, context }
  }
  const materialized = await materializeLargeValueRef(value, {
    workspaceId: context.executionContext.workspaceId,
    workflowId: context.executionContext.workflowId,
    executionId: context.executionContext.executionId,
    largeValueExecutionIds: context.executionContext.largeValueExecutionIds,
    largeValueKeys: context.executionContext.largeValueKeys,
    fileKeys: context.executionContext.fileKeys,
    allowLargeValueWorkflowScope: context.executionContext.allowLargeValueWorkflowScope,
    userId: context.executionContext.userId,
  })
  if (materialized === undefined) {
    throw getLargeValueMaterializationError(value)
  }
  return {
    value: materialized,
    context: withLocalLargeValueExecutionIds(context, materialized),
  }
}

async function hydrateExplicitBase64(
  file: unknown,
  context: PathNavigationContext
): Promise<string | undefined> {
  if (!isUserFileWithMetadata(file)) {
    return undefined
  }
  const hydrated = await hydrateUserFileWithBase64(file, {
    requestId: context.executionContext.metadata?.requestId,
    workspaceId: context.executionContext.workspaceId,
    workflowId: context.executionContext.workflowId,
    executionId: context.executionContext.executionId,
    largeValueExecutionIds: context.executionContext.largeValueExecutionIds,
    largeValueKeys: context.executionContext.largeValueKeys,
    fileKeys: context.executionContext.fileKeys,
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

async function readManifestIndexAsync(
  value: LargeArrayManifest,
  part: string,
  context: PathNavigationContext
): Promise<unknown> {
  const [item] = await readLargeArrayManifestSlice(value, Number.parseInt(part, 10), 1, {
    workspaceId: context.executionContext.workspaceId,
    workflowId: context.executionContext.workflowId,
    executionId: context.executionContext.executionId,
    largeValueExecutionIds: context.executionContext.largeValueExecutionIds,
    largeValueKeys: context.executionContext.largeValueKeys,
    allowLargeValueWorkflowScope: context.executionContext.allowLargeValueWorkflowScope,
    userId: context.executionContext.userId,
  })
  return item
}

async function navigateManifestMetadataOrIndexAsync(
  value: unknown,
  part: string,
  context: PathNavigationContext
): Promise<MaterializedNavigationValue> {
  if (!isLargeArrayManifest(value)) {
    return { value: undefined, context }
  }
  if (part === 'length' || part === 'totalCount') {
    return { value: value.totalCount, context }
  }
  if (part === 'chunkCount' || part === 'byteSize' || part === 'preview') {
    return { value: value[part], context: withLocalLargeValueExecutionIds(context, value[part]) }
  }
  if (/^\d+$/.test(part)) {
    const item = await readManifestIndexAsync(value, part, context)
    return {
      value: item,
      context: withLocalLargeValueExecutionIds(context, item),
    }
  }
  return { value: undefined, context }
}

/**
 * Server-side path navigation used during execution. It can hydrate persisted
 * large values and UserFile.base64 only when the requested path explicitly asks
 * for base64.
 */
export async function navigatePathAsync(
  obj: any,
  path: string[],
  context: PathNavigationContext
): Promise<any> {
  let current = obj
  let currentContext = context
  for (const part of path) {
    ;({ value: current, context: currentContext } = await materializeLargeValueRefOrThrow(
      current,
      currentContext
    ))

    if (current === null || current === undefined) {
      return undefined
    }

    if (part === 'base64') {
      const base64 = await hydrateExplicitBase64(current, currentContext)
      if (base64 !== undefined) {
        current = base64
        continue
      }
    }

    if (isLargeArrayManifest(current)) {
      ;({ value: current, context: currentContext } = await navigateManifestMetadataOrIndexAsync(
        current,
        part,
        currentContext
      ))
      continue
    }

    const arrayMatch = part.match(/^([^[]+)(\[.+)$/)
    if (arrayMatch) {
      const [, prop, bracketsPart] = arrayMatch
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[prop]
          : undefined
      ;({ value: current, context: currentContext } = await materializeLargeValueRefOrThrow(
        current,
        currentContext
      ))
      if (current === undefined || current === null) {
        return undefined
      }

      const indices = bracketsPart.match(/\[(\d+)\]/g)
      if (indices) {
        for (const indexMatch of indices) {
          ;({ value: current, context: currentContext } = await materializeLargeValueRefOrThrow(
            current,
            currentContext
          ))
          if (current === null || current === undefined) {
            return undefined
          }
          const idx = Number.parseInt(indexMatch.slice(1, -1), 10)
          if (isLargeArrayManifest(current)) {
            ;({ value: current, context: currentContext } =
              await navigateManifestMetadataOrIndexAsync(current, String(idx), currentContext))
          } else {
            current = Array.isArray(current) ? current[idx] : undefined
          }
        }
      }
    } else if (/^\d+$/.test(part)) {
      const index = Number.parseInt(part, 10)
      if (isLargeArrayManifest(current)) {
        ;({ value: current, context: currentContext } = await navigateManifestMetadataOrIndexAsync(
          current,
          part,
          currentContext
        ))
      } else {
        current = Array.isArray(current) ? current[index] : undefined
      }
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
