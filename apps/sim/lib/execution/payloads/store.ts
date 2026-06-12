import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { cacheLargeValue, materializeLargeValueRefSync } from '@/lib/execution/payloads/cache'
import { collectLargeValueKeys } from '@/lib/execution/payloads/large-execution-value'
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
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
  requireDurable?: boolean
  maxBytes?: number
  /**
   * When false, materialization does not register an execution_log reference for
   * the key. Read-only consumers (e.g. viewing/exporting a completed log) set
   * this: the value is already owned + referenced by its own execution, so
   * re-registering on every read is wasteful and a needless failure point.
   */
  trackReference?: boolean
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

async function registerPersistedValueOwner(
  key: string | undefined,
  size: number,
  referencedKeys: string[],
  context: LargeValueStoreContext
): Promise<boolean> {
  const { workspaceId, workflowId, executionId } = context
  if (!key || !workspaceId || !workflowId || !executionId) {
    return false
  }

  const { registerLargeValueOwner } = await import('@/lib/execution/payloads/large-value-metadata')
  return await registerLargeValueOwner(
    {
      key,
      workspaceId,
      workflowId,
      executionId,
      size,
    },
    referencedKeys
  )
}

async function deleteUntrackedPersistedValue(key: string): Promise<boolean> {
  try {
    const [{ StorageService }, { deleteFileMetadata }] = await Promise.all([
      import('@/lib/uploads'),
      import('@/lib/uploads/server/metadata'),
    ])
    const result = await StorageService.deleteFiles([key], 'execution')
    const deleteFailed = result.failed.some((failed) => failed.key === key)
    if (deleteFailed) {
      logger.warn('Failed to delete untracked large execution value from storage', {
        key,
      })
      return false
    }
    await deleteFileMetadata(key)
    return true
  } catch (error) {
    logger.warn('Failed to clean up untracked large execution value', {
      key,
      error: toError(error).message,
    })
    return false
  }
}

export async function storeLargeValue(
  value: unknown,
  json: string,
  size: number,
  context: LargeValueStoreContext
): Promise<LargeValueRef> {
  assertDurableLargeValueSize(size)
  const referencedKeys = collectLargeValueKeys(value)
  const id = `lv_${generateShortId(12)}`
  let key = await persistValue(id, json, context)
  if (key) {
    // Only clean up the uploaded object when registration definitively did NOT
    // record ownership (returns false). If registration THROWS, the metadata
    // state is uncertain (a row may have partially committed), so we propagate
    // without deleting — deleting could orphan a metadata row pointing at a
    // now-missing object.
    const registered = await registerPersistedValueOwner(key, size, referencedKeys, context)
    if (!registered) {
      await deleteUntrackedPersistedValue(key)
      if (context.requireDurable) {
        throw new Error('Failed to persist large execution value metadata')
      }
      key = undefined
    }
  }
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

  if (!ref.key || !isValidLargeValueKey(ref)) {
    return materializeLargeValueRefSync(ref, context)
  }

  if (context.trackReference !== false) {
    const { addLargeValueReference } = await import('@/lib/execution/payloads/large-value-metadata')
    // Reference tracking is GC-critical: if it fails, fail the read rather than
    // return a value whose reference was never recorded (it could later be
    // garbage-collected out from under a live consumer). Read-only consumers
    // that don't need a reference set trackReference: false to skip this.
    await addLargeValueReference(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
        source: 'execution_log',
      },
      ref.key
    )
  }

  try {
    const cached = materializeLargeValueRefSync(ref, context)
    if (cached !== undefined) {
      return cached
    }

    const value = await readLargeValueRefFromStorage(ref, {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      executionId: context.executionId,
      largeValueExecutionIds: context.largeValueExecutionIds,
      largeValueKeys: context.largeValueKeys,
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
