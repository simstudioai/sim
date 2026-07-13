'use server'

import { createLogger, type Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  assertKnownSizeWithinLimit,
  consumeOrCancelBody,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { StorageService } from '@/lib/uploads'
import { isExecutionFile } from '@/lib/uploads/contexts/execution/utils'
import {
  extractStorageKey,
  getFileExtension,
  getMimeTypeFromExtension,
  inferContextFromKey,
  isInternalFileUrl,
  processSingleFileToUserFile,
  type RawFileInput,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

const logger = createLogger('FileUtilsServer')

/**
 * Result type for file input resolution
 */
export interface FileResolutionResult {
  fileUrl?: string
  error?: {
    status: number
    message: string
  }
}

/**
 * Options for resolving file input to a URL
 */
export interface ResolveFileInputOptions {
  file?: RawFileInput
  filePath?: string
  userId: string
  requestId: string
  logger: Logger
  /**
   * Expiry for presigned URLs minted for stored files, in seconds.
   * Defaults to 5 minutes; raise it only when the external service fetches
   * the URL later than the current request (e.g. scheduled publishing).
   */
  presignExpirySeconds?: number
}

/**
 * Resolves file input (either a file object or filePath string) to a publicly accessible URL.
 * Handles:
 * - Processing raw file input via processSingleFileToUserFile
 * - Resolving internal URLs via resolveInternalFileUrl
 * - Generating presigned URLs for storage keys
 * - Validating external URLs via validateUrlWithDNS
 */
export async function resolveFileInputToUrl(
  options: ResolveFileInputOptions
): Promise<FileResolutionResult> {
  const { file, filePath, userId, requestId, logger, presignExpirySeconds = 5 * 60 } = options

  if (file) {
    let userFile: UserFile
    try {
      userFile = processSingleFileToUserFile(file, requestId, logger)
    } catch (error) {
      return {
        error: {
          status: 400,
          message: getErrorMessage(error, 'Failed to process file'),
        },
      }
    }

    // A stored file always gets a freshly minted presigned URL scoped to the
    // requested expiry — an embedded url (internal serve path or a previously
    // minted presigned link) may be stale, shorter-lived than required, or
    // point at a different object than the verified key.
    if (userFile.key) {
      const context = resolveTrustedFileContext(userFile.key, userFile.context)
      const hasAccess = await verifyFileAccess(userFile.key, userId, undefined, context, false)

      if (!hasAccess) {
        logger.warn(`[${requestId}] Unauthorized presigned URL generation attempt`, {
          userId,
          key: userFile.key,
          context,
        })
        return { error: { status: 404, message: 'File not found' } }
      }

      const fileUrl = await StorageService.generatePresignedDownloadUrl(
        userFile.key,
        context,
        presignExpirySeconds
      )
      return { fileUrl }
    }

    let fileUrl = userFile.url || ''

    // Without a key, the schema guarantees the url references an uploaded
    // file, so resolve the internal serve path to a presigned URL.
    if (fileUrl && isInternalFileUrl(fileUrl)) {
      const resolution = await resolveInternalFileUrl(
        fileUrl,
        userId,
        requestId,
        logger,
        presignExpirySeconds
      )
      if (resolution.error) {
        return { error: resolution.error }
      }
      fileUrl = resolution.fileUrl || ''
    }

    return { fileUrl }
  }

  if (filePath) {
    let fileUrl = filePath

    if (isInternalFileUrl(filePath)) {
      const resolution = await resolveInternalFileUrl(
        filePath,
        userId,
        requestId,
        logger,
        presignExpirySeconds
      )
      if (resolution.error) {
        return { error: resolution.error }
      }
      fileUrl = resolution.fileUrl || fileUrl
    } else if (filePath.startsWith('/')) {
      logger.warn(`[${requestId}] Invalid internal path`, {
        userId,
        path: filePath.substring(0, 50),
      })
      return {
        error: {
          status: 400,
          message: 'Invalid file path. Only uploaded files are supported for internal paths.',
        },
      }
    } else {
      const urlValidation = await validateUrlWithDNS(fileUrl, 'filePath')
      if (!urlValidation.isValid) {
        return { error: { status: 400, message: urlValidation.error || 'Invalid URL' } }
      }
    }

    return { fileUrl }
  }

  return { error: { status: 400, message: 'File input is required' } }
}

/**
 * Options for {@link downloadFileFromUrl}.
 */
export interface DownloadFileFromUrlOptions {
  /** Download timeout for external URLs. Defaults to the max execution timeout. */
  timeoutMs?: number
  /** Hard cap on the number of bytes read from the source. */
  maxBytes?: number
  /**
   * Principal the download is performed on behalf of. Required to authorize
   * internal (`/api/files/serve/...`) URLs: the resolved storage key is checked
   * with {@link verifyFileAccess} before any bytes are read. Without it, internal
   * URLs are rejected (fail closed) so a `/api/files/serve/` substring can never
   * be treated as implicitly trusted.
   */
  userId?: string
}

/**
 * Download a file from a URL (internal or external).
 *
 * For internal URLs, uses direct storage access (server-side only) after
 * authorizing the resolved storage key against `userId`. Context is derived
 * from the key via {@link inferContextFromKey}, never from a caller-controlled
 * `?context=` query param — trusting the param would let a private key be
 * labeled with a world-readable context (e.g. profile-pictures) so
 * {@link verifyFileAccess} short-circuits to granted while the private object is
 * still read. This mirrors how `/api/files/serve` resolves context.
 *
 * For external URLs, validates DNS/SSRF and uses secure fetch with IP pinning.
 */
export async function downloadFileFromUrl(
  fileUrl: string,
  options: DownloadFileFromUrlOptions = {}
): Promise<Buffer> {
  const { timeoutMs = getMaxExecutionTimeout(), maxBytes, userId } = options

  if (isInternalFileUrl(fileUrl)) {
    if (!userId) {
      logger.warn('Internal file download denied: no userId provided', { fileUrl })
      throw new Error('Access denied: internal file URL requires an authenticated user')
    }

    const key = extractStorageKey(fileUrl)
    if (!key) {
      logger.warn('Internal file download denied: could not resolve storage key', { fileUrl })
      throw new Error('Access denied: could not resolve internal file key')
    }

    const context = inferContextFromKey(key)

    const hasAccess = await verifyFileAccess(key, userId, undefined, context, false)
    if (!hasAccess) {
      logger.warn('Internal file download denied: access check failed', { key, context, userId })
      throw new Error('Access denied: file not found or insufficient permissions')
    }

    const { downloadFile } = await import('@/lib/uploads/core/storage-service')
    return downloadFile({ key, context, maxBytes })
  }

  const urlValidation = await validateUrlWithDNS(fileUrl, 'fileUrl')
  if (!urlValidation.isValid) {
    throw new Error(`Invalid file URL: ${urlValidation.error}`)
  }

  const response = await secureFetchWithPinnedIP(fileUrl, urlValidation.resolvedIP!, {
    timeout: timeoutMs,
    maxResponseBytes: maxBytes,
  })

  if (!response.ok) {
    await consumeOrCancelBody(response)
    throw new Error(`Failed to download file: ${response.statusText}`)
  }

  return readResponseToBufferWithLimit(response, {
    maxBytes: maxBytes ?? Number.MAX_SAFE_INTEGER,
    label: 'file download',
  })
}

export async function resolveInternalFileUrl(
  filePath: string,
  userId: string,
  requestId: string,
  logger: Logger,
  presignExpirySeconds = 5 * 60
): Promise<{ fileUrl?: string; error?: { status: number; message: string } }> {
  if (!isInternalFileUrl(filePath)) {
    return { fileUrl: filePath }
  }

  try {
    const storageKey = extractStorageKey(filePath)
    const context = inferContextFromKey(storageKey)
    const hasAccess = await verifyFileAccess(storageKey, userId, undefined, context, false)

    if (!hasAccess) {
      logger.warn(`[${requestId}] Unauthorized presigned URL generation attempt`, {
        userId,
        key: storageKey,
        context,
      })
      return { error: { status: 404, message: 'File not found' } }
    }

    const fileUrl = await StorageService.generatePresignedDownloadUrl(
      storageKey,
      context,
      presignExpirySeconds
    )
    logger.info(`[${requestId}] Generated presigned URL for ${context} file`)
    return { fileUrl }
  } catch (error) {
    logger.error(`[${requestId}] Failed to generate presigned URL:`, error)
    return { error: { status: 500, message: 'Failed to generate file access URL' } }
  }
}

/**
 * Downloads a file from storage (execution or regular)
 * @param userFile - UserFile object
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns Buffer containing file data
 */
export async function downloadFileFromStorage(
  userFile: UserFile,
  requestId: string,
  logger: Logger,
  options: { maxBytes?: number } = {}
): Promise<Buffer> {
  let buffer: Buffer
  if (options.maxBytes !== undefined && userFile.size > options.maxBytes) {
    assertKnownSizeWithinLimit(userFile.size, options.maxBytes, 'storage file download')
  }

  if (isExecutionFile(userFile)) {
    logger.info(`[${requestId}] Downloading from execution storage: ${userFile.key}`)
    const { downloadExecutionFile } = await import(
      '@/lib/uploads/contexts/execution/execution-file-manager'
    )
    buffer = await downloadExecutionFile(userFile, { maxBytes: options.maxBytes })
  } else if (userFile.key) {
    const context = resolveTrustedFileContext(userFile.key, userFile.context)
    logger.info(`[${requestId}] Downloading from ${context} storage: ${userFile.key}`)

    const { downloadFile } = await import('@/lib/uploads/core/storage-service')
    buffer = await downloadFile({
      key: userFile.key,
      context,
      maxBytes: options.maxBytes,
    })
  } else {
    throw new Error('File has no key - cannot download')
  }

  if (options.maxBytes !== undefined) {
    assertKnownSizeWithinLimit(buffer.length, options.maxBytes, 'storage file download')
  }

  return buffer
}

/**
 * Result of {@link downloadServableFileFromStorage}: the bytes a consumer should
 * actually attach/upload, plus the content type that matches those bytes.
 */
export interface ServableFile {
  buffer: Buffer
  contentType: string
}

/**
 * Downloads a workspace file and resolves it to its SERVABLE bytes — the variant
 * every tool that hands a file to an external service (email attachments, chat
 * uploads, provider file inputs) should use instead of {@link downloadFileFromStorage}.
 *
 * AI-generated docs (pdf/docx/pptx/xlsx) store their generation SOURCE as the
 * primary file and keep the rendered binary in a separate content-addressed
 * artifact store. A raw download therefore yields source text under a `.pdf`
 * name — the file the recipient cannot open. This swaps in the compiled artifact
 * (and the correct binary content type) via the same resolver the file-serve
 * route uses, so the serve and attachment paths resolve identically. Non-doc files
 * and real uploaded binaries pass through unchanged, carrying `userFile.type` when set.
 *
 * Throws `DocCompileUserError` when a generated doc's artifact is not ready (still
 * compiling) — callers should surface a retryable error rather than attach source.
 */
export async function downloadServableFileFromStorage(
  userFile: UserFile,
  requestId: string,
  logger: Logger,
  options: { maxBytes?: number; signal?: AbortSignal; ownerKey?: string } = {}
): Promise<ServableFile> {
  const buffer = await downloadFileFromStorage(userFile, requestId, logger, {
    maxBytes: options.maxBytes,
  })

  // Cheap pre-filter so only generated-doc candidates pay for the heavier resolver
  // import below.
  const ext = getFileExtension(userFile.name)
  if (ext !== 'pdf' && ext !== 'docx' && ext !== 'pptx' && ext !== 'xlsx') {
    return { buffer, contentType: userFile.type || getMimeTypeFromExtension(ext) }
  }

  const { parseWorkspaceFileKey } = await import(
    '@/lib/uploads/contexts/workspace/workspace-file-manager'
  )
  const workspaceId = userFile.key ? (parseWorkspaceFileKey(userFile.key) ?? undefined) : undefined

  const { resolveServableDocBytes } = await import('@/lib/copilot/tools/server/files/doc-compile')
  const resolved = await resolveServableDocBytes({
    rawBuffer: buffer,
    fileName: userFile.name,
    workspaceId,
    ownerKey: options.ownerKey,
    signal: options.signal,
  })

  // Re-check: the raw download enforced maxBytes on the source, but a generated doc
  // resolves to a larger artifact.
  if (options.maxBytes !== undefined && resolved.buffer.length > options.maxBytes) {
    assertKnownSizeWithinLimit(resolved.buffer.length, options.maxBytes, 'servable file download')
  }

  return resolved
}
