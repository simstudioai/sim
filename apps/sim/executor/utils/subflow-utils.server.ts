import { toError } from '@sim/utils/errors'
import { recordMaterializedAccessKeys } from '@/lib/execution/payloads/access-keys'
import {
  isLargeArrayManifest,
  LARGE_ARRAY_MANIFEST_MARKER,
  materializeLargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest'
import { isLargeValueRef, LARGE_VALUE_REF_MARKER } from '@/lib/execution/payloads/large-value-ref'
import { MAX_DURABLE_LARGE_VALUE_BYTES } from '@/lib/execution/payloads/materialization.server'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'
import { REFERENCE } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { VariableResolver } from '@/executor/variables/resolver'

async function normalizeCollectionValue(ctx: ExecutionContext, value: unknown): Promise<any[]> {
  if (Array.isArray(value)) {
    return value
  }

  if (isLargeArrayManifest(value)) {
    const materialized = await materializeLargeArrayManifest(value, {
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      largeValueExecutionIds: ctx.largeValueExecutionIds,
      largeValueKeys: ctx.largeValueKeys,
      fileKeys: ctx.fileKeys,
      allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
      userId: ctx.userId,
      maxBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
    })
    recordMaterializedAccessKeys(ctx, materialized)
    return materialized
  }

  if (isLargeValueRef(value)) {
    const materialized = await materializeLargeValueRef(value, {
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      largeValueExecutionIds: ctx.largeValueExecutionIds,
      largeValueKeys: ctx.largeValueKeys,
      fileKeys: ctx.fileKeys,
      allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
      userId: ctx.userId,
      maxBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
    })
    if (materialized === undefined) {
      throw new Error('Large execution value is unavailable.')
    }
    recordMaterializedAccessKeys(ctx, materialized)
    return normalizeCollectionValue(ctx, materialized)
  }

  if (typeof value === 'object' && value !== null) {
    if ((value as Record<string, unknown>)[LARGE_ARRAY_MANIFEST_MARKER] === true) {
      throw new Error('Invalid large array manifest.')
    }
    if ((value as Record<string, unknown>)[LARGE_VALUE_REF_MARKER] === true) {
      throw new Error('Invalid large value ref.')
    }
    return Object.entries(value)
  }

  if (value === null) {
    return []
  }

  throw new Error('Value did not resolve to an array or object')
}

/**
 * Resolves loop/parallel collection inputs on the server, including durable
 * execution values that cannot be imported into client-reachable utilities.
 */
export async function resolveArrayInputAsync(
  ctx: ExecutionContext,
  items: any,
  resolver: VariableResolver | null,
  currentNodeId = ''
): Promise<any[]> {
  if (typeof items !== 'string') {
    if (items === null) {
      return []
    }
    if (!Array.isArray(items) && typeof items !== 'object') {
      if (!resolver) {
        return []
      }
      try {
        const resolved = (await resolver.resolveInputs(ctx, currentNodeId, { items })).items
        return normalizeCollectionValue(ctx, resolved)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Resolved items')) {
          throw error
        }
        throw new Error(`Failed to resolve items: ${toError(error).message}`)
      }
    }
    return normalizeCollectionValue(ctx, items)
  }

  if (items.startsWith(REFERENCE.START) && items.endsWith(REFERENCE.END) && resolver) {
    try {
      const resolved = await resolver.resolveSingleReference(ctx, currentNodeId, items, undefined, {
        allowLargeValueRefs: true,
      })
      return normalizeCollectionValue(ctx, resolved)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Reference "')) {
        throw error
      }
      throw new Error(`Failed to resolve reference "${items}": ${toError(error).message}`)
    }
  }

  try {
    const normalized = items.replace(/'/g, '"')
    const parsed = JSON.parse(normalized)
    return normalizeCollectionValue(ctx, parsed)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Parsed value')) {
      throw error
    }
    throw new Error(`Failed to parse items as JSON: "${items}"`)
  }
}
