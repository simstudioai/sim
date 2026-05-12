import { createLogger, type Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  getLargeValueMaterializationError,
  isLargeValueRef,
  isLargeValueStorageKey,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'
import { ExecutionResourceLimitError } from '@/lib/execution/resource-errors'
import type { StorageContext } from '@/lib/uploads'
import { bufferToBase64, inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ExecutionPayloadMaterialization')

export const MAX_DURABLE_LARGE_VALUE_BYTES = 64 * 1024 * 1024
export const MAX_INLINE_MATERIALIZATION_BYTES = 16 * 1024 * 1024
export const MAX_FUNCTION_FILE_BYTES = 64 * 1024 * 1024
export const MAX_FUNCTION_INLINE_BYTES = 10 * 1024 * 1024

export interface ExecutionMaterializationContext {
  workflowId?: string
  workspaceId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
  requestId?: string
  logger?: Logger
}

export interface MaterializeLargeValueOptions extends ExecutionMaterializationContext {
  maxBytes?: number
}

export interface ReadUserFileContentOptions extends ExecutionMaterializationContext {
  maxBytes?: number
  maxSourceBytes?: number
  offset?: number
  length?: number
  chunked?: boolean
  encoding: 'base64' | 'text'
}

function getLogger(options: ExecutionMaterializationContext): Logger {
  return options.logger ?? logger
}

export function assertDurableLargeValueSize(size: number): void {
  if (size > MAX_DURABLE_LARGE_VALUE_BYTES) {
    throw new ExecutionResourceLimitError({
      resource: 'execution_payload_bytes',
      attemptedBytes: size,
      limitBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
    })
  }
}

export function assertInlineMaterializationSize(size: number, maxBytes?: number): void {
  const limit = maxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES
  if (size > limit) {
    throw new ExecutionResourceLimitError({
      resource: 'execution_payload_bytes',
      attemptedBytes: size,
      limitBytes: limit,
    })
  }
}

export function isValidLargeValueKey(ref: LargeValueRef): boolean {
  return Boolean(ref.key && isLargeValueStorageKey(ref.key, ref.id, ref.executionId))
}

export function assertLargeValueRefAccess(
  ref: LargeValueRef,
  context: ExecutionMaterializationContext
): void {
  if (!context.executionId) {
    throw new Error('Large execution value requires an execution context.')
  }
  const allowedExecutionIds = new Set([
    context.executionId,
    ...(context.largeValueExecutionIds ?? []),
  ])

  const parts = ref.key?.split('/') ?? []
  const [, workspaceId, workflowId, executionId] = parts

  if (!ref.key) {
    if (ref.executionId && !allowedExecutionIds.has(ref.executionId)) {
      throw new Error('Large execution value is not available in this execution.')
    }
    return
  }
  if (!context.workspaceId || !context.workflowId) {
    throw new Error('Large execution value requires workspace and workflow context.')
  }
  const workflowScopeAllowed =
    context.allowLargeValueWorkflowScope &&
    context.workspaceId === workspaceId &&
    context.workflowId === workflowId
  if (ref.executionId && !allowedExecutionIds.has(ref.executionId) && !workflowScopeAllowed) {
    throw new Error('Large execution value is not available in this execution.')
  }
  if (!allowedExecutionIds.has(executionId) && !workflowScopeAllowed) {
    throw new Error('Large execution value is not available in this execution.')
  }
  if (context.workspaceId && workspaceId !== context.workspaceId) {
    throw new Error('Large execution value is not available in this execution.')
  }
  if (context.workflowId && workflowId !== context.workflowId) {
    throw new Error('Large execution value is not available in this execution.')
  }
}

export async function readLargeValueRefFromStorage(
  ref: LargeValueRef,
  options: MaterializeLargeValueOptions = {}
): Promise<unknown | undefined> {
  const log = getLogger(options)
  if (!isLargeValueRef(ref) || !ref.key || !isValidLargeValueKey(ref)) {
    return undefined
  }

  assertLargeValueRefAccess(ref, options)
  assertInlineMaterializationSize(ref.size, options.maxBytes)

  try {
    const { StorageService } = await import('@/lib/uploads')
    const buffer = await StorageService.downloadFile({
      key: ref.key,
      context: 'execution',
    })
    if (buffer.length > (options.maxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES)) {
      throw new ExecutionResourceLimitError({
        resource: 'execution_payload_bytes',
        attemptedBytes: buffer.length,
        limitBytes: options.maxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES,
      })
    }
    return JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    if (error instanceof ExecutionResourceLimitError) {
      throw error
    }
    log.warn('Failed to materialize persisted large execution value', {
      id: ref.id,
      key: ref.key,
      error: toError(error).message,
    })
    return undefined
  }
}

function normalizeRange(buffer: Buffer, options: ReadUserFileContentOptions): Buffer {
  const offset = Math.max(0, Math.floor(options.offset ?? 0))
  const maxLength = options.maxBytes ?? MAX_FUNCTION_INLINE_BYTES
  const requestedLength = options.length === undefined ? maxLength : Math.floor(options.length)
  const length = Math.max(0, Math.min(requestedLength, maxLength))
  return buffer.subarray(offset, offset + length)
}

function getExecutionKeyParts(key: string):
  | {
      workspaceId: string
      workflowId: string
      executionId: string
    }
  | undefined {
  const parts = key.split('/')
  if (parts[0] !== 'execution' || parts.length < 5) {
    return undefined
  }

  return {
    workspaceId: parts[1],
    workflowId: parts[2],
    executionId: parts[3],
  }
}

function assertExecutionFileScope(key: string, options: ExecutionMaterializationContext): void {
  const parts = getExecutionKeyParts(key)
  if (!parts) {
    throw new Error('File is not available in this execution.')
  }

  const allowedExecutionIds = new Set([
    options.executionId,
    ...(options.largeValueExecutionIds ?? []),
  ])
  const workflowScopeAllowed =
    options.allowLargeValueWorkflowScope &&
    options.workspaceId === parts.workspaceId &&
    options.workflowId === parts.workflowId
  if (
    !options.executionId ||
    (!allowedExecutionIds.has(parts.executionId) && !workflowScopeAllowed)
  ) {
    throw new Error('File is not available in this execution.')
  }

  if (options.workspaceId && parts.workspaceId !== options.workspaceId) {
    throw new Error('File is not available in this execution.')
  }

  if (options.workflowId && parts.workflowId !== options.workflowId) {
    throw new Error('File is not available in this execution.')
  }
}

function getVerifiedStorageContext(file: UserFile): StorageContext {
  if (!file.key) {
    throw new Error('File content requires a storage key.')
  }

  const inferredContext = inferContextFromKey(file.key)
  if (file.context && file.context !== inferredContext) {
    throw new Error('File context does not match its storage key.')
  }

  return inferredContext
}

export async function assertUserFileContentAccess(
  file: UserFile,
  options: ExecutionMaterializationContext
): Promise<void> {
  const context = getVerifiedStorageContext(file)

  if (context === 'execution') {
    assertExecutionFileScope(file.key, options)
  }

  if (!options.userId) {
    throw new Error('File access requires an authenticated user.')
  }

  const { verifyFileAccess } = await import('@/app/api/files/authorization')
  const hasAccess = await verifyFileAccess(file.key, options.userId, undefined, context, false)
  if (!hasAccess) {
    throw new Error('File is not available in this execution.')
  }
}

export async function readUserFileContent(
  file: unknown,
  options: ReadUserFileContentOptions
): Promise<string> {
  if (!isUserFileWithMetadata(file)) {
    throw new Error('Expected a file object with metadata.')
  }

  await assertUserFileContentAccess(file, options)

  const maxSourceBytes = options.maxSourceBytes ?? MAX_FUNCTION_FILE_BYTES
  if (Number.isFinite(file.size) && file.size > maxSourceBytes) {
    throw new ExecutionResourceLimitError({
      resource: 'execution_payload_bytes',
      attemptedBytes: file.size,
      limitBytes: maxSourceBytes,
    })
  }

  let buffer: Buffer | null = null
  const log = getLogger(options)
  const requestId = options.requestId ?? 'unknown'

  buffer = await downloadFileFromStorage(file, requestId, log)

  if (!buffer) {
    throw new Error(`File content for ${file.name} is unavailable.`)
  }
  if (buffer.length > maxSourceBytes) {
    throw new ExecutionResourceLimitError({
      resource: 'execution_payload_bytes',
      attemptedBytes: buffer.length,
      limitBytes: maxSourceBytes,
    })
  }

  const shouldSlice =
    options.chunked || options.offset !== undefined || options.length !== undefined
  const selected = shouldSlice ? normalizeRange(buffer, options) : buffer
  assertInlineMaterializationSize(selected.length, options.maxBytes ?? MAX_FUNCTION_INLINE_BYTES)

  return options.encoding === 'base64' ? bufferToBase64(selected) : selected.toString('utf8')
}

export function unavailableLargeValueError(ref: LargeValueRef): Error {
  return getLargeValueMaterializationError(ref)
}
