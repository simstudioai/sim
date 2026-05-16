import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { cacheLargeValue, materializeLargeValueRefSync } from '@/lib/execution/payloads/cache'
import {
  LARGE_VALUE_REF_VERSION,
  type LargeValueKind,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import {
  assertDurableLargeValueSize,
  assertInlineMaterializationSize,
  assertLargeValueRefAccess,
  isValidLargeValueKey,
  readLargeValueRefFromStorage,
} from '@/lib/execution/payloads/materialization.server'
import { generateExecutionFileKey } from '@/lib/uploads/contexts/execution/utils'

const logger = createLogger('LargeExecutionPayloadStore')

export interface LargeValueStoreContext {
  workspaceId?: string
  workflowId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
  requireDurable?: boolean
  maxBytes?: number
}

function getKind(value: unknown): LargeValueKind {
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  if (value && typeof value === 'object') return 'object'
  return 'json'
}

function getPreview(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncate(value, 256)
  }
  if (Array.isArray(value)) {
    return { length: value.length }
  }
  if (value && typeof value === 'object') {
    return { keys: Object.keys(value).slice(0, 20) }
  }
  return value
}

async function persistValue(
  id: string,
  json: string,
  context: LargeValueStoreContext
): Promise<string | undefined> {
  const { workspaceId, workflowId, executionId, userId } = context
  if (!workspaceId || !workflowId || !executionId) {
    if (context.requireDurable) {
      throw new Error(
        'Cannot persist large execution value without workspace, workflow, and execution IDs'
      )
    }
    return undefined
  }

  const key = generateExecutionFileKey(
    { workspaceId, workflowId, executionId },
    `large-value-${id}.json`
  )

  try {
    const { StorageService } = await import('@/lib/uploads')
    const fileInfo = await StorageService.uploadFile({
      file: Buffer.from(json, 'utf8'),
      fileName: key,
      contentType: 'application/json',
      context: 'execution',
      preserveKey: true,
      customKey: key,
      metadata: {
        originalName: `large-value-${id}.json`,
        uploadedAt: new Date().toISOString(),
        purpose: 'execution-large-value',
        workspaceId,
        ...(userId ? { userId } : {}),
      },
    })
    return fileInfo.key
  } catch (error) {
    if (context.requireDurable) {
      throw new Error(`Failed to persist large execution value: ${toError(error).message}`)
    }
    logger.warn('Failed to persist large execution value, keeping in memory only', {
      id,
      error: toError(error).message,
    })
    return undefined
  }
}

export async function storeLargeValue(
  value: unknown,
  json: string,
  size: number,
  context: LargeValueStoreContext
): Promise<LargeValueRef> {
  assertDurableLargeValueSize(size)
  const id = `lv_${generateShortId(12)}`
  const key = await persistValue(id, json, context)
  const cached = cacheLargeValue(id, value, size, context, { recoverable: Boolean(key) })
  if (!key && !cached) {
    throw new Error('Cannot retain large execution value without durable storage')
  }

  return {
    __simLargeValueRef: true,
    version: LARGE_VALUE_REF_VERSION,
    id,
    kind: getKind(value),
    size,
    key,
    executionId: context.executionId,
    preview: getPreview(value),
  }
}

export async function materializeLargeValueRef(
  ref: LargeValueRef,
  context?: LargeValueStoreContext
): Promise<unknown> {
  if (!context?.executionId) {
    return undefined
  }

  assertLargeValueRefAccess(ref, context)
  assertInlineMaterializationSize(ref.size, context.maxBytes)

  const cached = materializeLargeValueRefSync(ref, context)
  if (cached !== undefined) {
    return cached
  }

  if (!ref.key || !isValidLargeValueKey(ref)) {
    return undefined
  }

  try {
    const value = await readLargeValueRefFromStorage(ref, {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      executionId: context.executionId,
      largeValueExecutionIds: context.largeValueExecutionIds,
      allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
      userId: context.userId,
      maxBytes: context.maxBytes ?? ref.size,
    })
    if (value === undefined) {
      return undefined
    }
    cacheLargeValue(
      ref.id,
      value,
      ref.size,
      {
        ...context,
        executionId: ref.executionId ?? context.executionId,
      },
      { recoverable: true }
    )
    return value
  } catch (error) {
    logger.warn('Failed to materialize persisted large execution value', {
      id: ref.id,
      key: ref.key,
      error,
    })
    return undefined
  }
}
