import { assertKnownSizeWithinLimit, PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  type ExecutionContext,
  generateFileId,
  generateUniqueExecutionFileKey,
} from '@/lib/uploads/contexts/execution/utils'
import {
  createMultipartUpload,
  deleteFile,
  downloadFileStream,
  generatePresignedDownloadUrl,
} from '@/lib/uploads/core/storage-service'
import {
  MAX_WORKSPACE_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
} from '@/lib/uploads/shared/types'
import { resolveTrustedFileContext } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { isUuid, sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'

const EXECUTION_DOWNLOAD_URL_TTL_SECONDS = 300

function clampLimit(callerLimit: number, platformLimit: number): number {
  if (!Number.isSafeInteger(callerLimit) || callerLimit < 1) {
    throw new Error('Oracle EPM file limit must be a positive safe integer')
  }
  return Math.min(callerLimit, platformLimit)
}

function safeFileName(fileName: string): string {
  const sanitized = sanitizeFileName(fileName).slice(0, 255)
  return !sanitized || sanitized === '.' || sanitized === '..' ? 'download' : sanitized
}

function safeContentType(contentType: string | undefined): string {
  return contentType &&
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(contentType)
    ? contentType
    : 'application/octet-stream'
}

function assertExecutionContext(context: ExecutionContext): void {
  if (!isUuid(context.workspaceId) || !isUuid(context.workflowId) || !isUuid(context.executionId)) {
    throw new Error('Oracle EPM execution file context is invalid')
  }
}

/** Authorized, byte-counted Sim source consumed by a product-owned upload protocol. */
export interface OracleEpmSourceFile {
  readonly fileName: string
  readonly contentType: string
  readonly maxBytes: number
  readonly chunks: AsyncIterable<Buffer>
}

/** Authorizes a Sim file, then opens a byte-counted source stream for a child uploader. */
export async function openOracleEpmSourceFile(input: {
  file: UserFile
  userId: string
  maxBytes: number
  signal?: AbortSignal
}): Promise<OracleEpmSourceFile> {
  const { file, userId, signal } = input
  if (!file.key || !userId) throw new Error('Oracle EPM source file is invalid')
  const maxBytes = clampLimit(input.maxBytes, MAX_WORKSPACE_FILE_SIZE)
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error('Oracle EPM source file metadata is invalid')
  }
  assertKnownSizeWithinLimit(file.size, maxBytes, 'Oracle EPM source file')
  const context = resolveTrustedFileContext(file.key, file.context)
  const allowed = await verifyFileAccess(file.key, userId, undefined, context, false)
  if (!allowed) throw new Error('Oracle EPM source file was not found')
  signal?.throwIfAborted()

  const chunks = (async function* boundedChunks(): AsyncIterable<Buffer> {
    const stream = await downloadFileStream({ key: file.key, context })
    let bytes = 0
    const abort = () => stream.destroy(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      for await (const chunk of stream) {
        signal?.throwIfAborted()
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        bytes += buffer.length
        if (bytes > maxBytes) {
          throw new PayloadSizeLimitError({
            label: 'Oracle EPM source file',
            maxBytes,
            observedBytes: bytes,
          })
        }
        yield buffer
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      stream.destroy()
    }
  })()

  return Object.freeze({
    fileName: safeFileName(file.name),
    contentType: safeContentType(file.type),
    maxBytes,
    chunks,
  })
}

/** Streams a bounded Oracle response into existing execution-file storage. */
export async function storeOracleEpmDownload(input: {
  body: ReadableStream<Uint8Array>
  fileName: string
  contentType?: string
  contentLength?: number
  context: ExecutionContext
  maxBytes: number
  signal?: AbortSignal
}): Promise<UserFile> {
  const maxBytes = clampLimit(input.maxBytes, MAX_WORKSPACE_FORMDATA_FILE_SIZE)
  assertExecutionContext(input.context)
  if (input.contentLength !== undefined) {
    if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0) {
      throw new Error('Oracle EPM download metadata is invalid')
    }
    assertKnownSizeWithinLimit(input.contentLength, maxBytes, 'Oracle EPM download')
  }
  const fileName = safeFileName(input.fileName)
  const contentType = safeContentType(input.contentType)
  const key = generateUniqueExecutionFileKey(input.context, fileName)
  const upload = await createMultipartUpload({
    key,
    context: 'execution',
    contentType,
    completionPolicy: 'create-only',
  })
  const reader = input.body.getReader()
  let bytes = 0
  let completed = false
  let cleanupPromise: Promise<void> | undefined
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= completed
      ? deleteFile({ key, context: 'execution' }).catch(() => undefined)
      : upload.abort().catch(() => undefined)
    return cleanupPromise
  }
  const abort = () => {
    void reader.cancel(input.signal?.reason).catch(() => undefined)
    void cleanup()
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      input.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        throw new PayloadSizeLimitError({
          label: 'Oracle EPM download',
          maxBytes,
          observedBytes: bytes,
        })
      }
      await upload.write(Buffer.from(value))
    }
    const stored = await upload.complete()
    completed = true
    if (stored.size !== bytes) {
      throw new Error('Oracle EPM download storage size did not match the streamed bytes')
    }
    const url = await generatePresignedDownloadUrl(
      stored.key,
      'execution',
      EXECUTION_DOWNLOAD_URL_TTL_SECONDS
    )
    return {
      id: generateFileId(),
      name: fileName,
      url,
      size: stored.size,
      type: contentType,
      key: stored.key,
      context: 'execution',
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    await cleanup()
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abort)
    if (!completed) await cleanup()
    reader.releaseLock()
  }
}
