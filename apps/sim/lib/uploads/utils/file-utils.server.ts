import type { Principal } from '@sim/auth/principal'
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
  isPayloadSizeLimitError,
  PayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { StorageService } from '@/lib/uploads'
import { isExecutionFile } from '@/lib/uploads/contexts/execution/utils'
// This file is lazily imported back by workspace-file-manager, so that edge
// stays dynamic on their side; these statics do not close a load-time cycle.
import { parseWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  extractStorageKey,
  extractWorkspaceIdFromExecutionKey,
  getFileExtension,
  getMimeTypeFromExtension,
  inferContextFromKey,
  isInternalFileUrl,
  isRenderableDocumentName,
  processSingleFileToUserFile,
  type RawFileInput,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'
import { isSimPageSource, SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { renderSimPageDocumentWithAssets } from '@/lib/workspace-files/page-document.server'
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
  /** Rejects tracked files whose bytes cannot safely cross a model boundary. */
  modelEgress?: boolean
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
  const {
    file,
    filePath,
    userId,
    requestId,
    logger,
    presignExpirySeconds = 5 * 60,
    modelEgress = false,
  } = options

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

      if (modelEgress && !(await isModelSafeWorkspaceFileKey(userFile.key))) {
        return {
          error: {
            status: 400,
            message: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
          },
        }
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
      if (modelEgress) {
        const storageKey = extractStorageKey(filePath)
        if (!(await isModelSafeWorkspaceFileKey(storageKey))) {
          return {
            error: {
              status: 400,
              message: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
            },
          }
        }
      }
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
      const urlValidation = await validateUrlWithDNS(fileUrl, 'filePath', 'contentFetch')
      if (!urlValidation.isValid) {
        return { error: { status: 400, message: urlValidation.error } }
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
  /** Cancels an external download when the surrounding request or execution stops. */
  signal?: AbortSignal
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
  const { timeoutMs = getMaxExecutionTimeout(), maxBytes, signal, userId } = options

  signal?.throwIfAborted()

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
    return downloadFile({ key, context, maxBytes, signal })
  }

  const urlValidation = await validateUrlWithDNS(fileUrl, 'fileUrl', 'contentFetch')
  if (!urlValidation.isValid) {
    throw new Error(`Invalid file URL: ${urlValidation.error}`)
  }

  const response = await secureFetchWithPinnedIP(fileUrl, urlValidation.resolvedIP, {
    profile: 'contentFetch',
    timeout: timeoutMs,
    maxResponseBytes: maxBytes,
    signal,
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
 * Downloads a file from storage (execution or regular) into a single resident buffer.
 *
 * `maxBytes` is required, not optional. Workspace files are admitted at 5 GB, so a
 * caller that forgets a ceiling inherits "unbounded" and can allocate gigabytes inside
 * the shared app process. Making the parameter mandatory means a new call site has to
 * name its limit — see {@link MAX_BUFFERED_TRANSFER_BYTES} for the default, and prefer
 * the destination's own documented limit whenever it is lower. The size is checked
 * twice: against the declared size before any bytes move, and against the delivered
 * buffer, because the declared size comes from the caller and may be a lie.
 *
 * @param userFile - UserFile object
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @param options.maxBytes - Hard ceiling; throws `PayloadSizeLimitError` when exceeded
 * @returns Buffer containing file data
 */
export async function downloadFileFromStorage(
  userFile: UserFile,
  requestId: string,
  logger: Logger,
  options: { maxBytes: number; signal?: AbortSignal }
): Promise<Buffer> {
  const { maxBytes, signal } = options
  signal?.throwIfAborted()
  let buffer: Buffer
  assertKnownSizeWithinLimit(userFile.size, maxBytes, 'storage file download')

  if (isExecutionFile(userFile)) {
    logger.info(`[${requestId}] Downloading from execution storage: ${userFile.key}`)
    const { downloadExecutionFile } = await import(
      '@/lib/uploads/contexts/execution/execution-file-manager'
    )
    buffer = await downloadExecutionFile(userFile, { maxBytes, signal })
  } else if (userFile.key) {
    const context = resolveTrustedFileContext(userFile.key, userFile.context)
    logger.info(`[${requestId}] Downloading from ${context} storage: ${userFile.key}`)

    const { downloadFile } = await import('@/lib/uploads/core/storage-service')
    buffer = await downloadFile({
      key: userFile.key,
      context,
      maxBytes,
      signal,
    })
  } else {
    throw new Error('File has no key - cannot download')
  }

  assertKnownSizeWithinLimit(buffer.length, maxBytes, 'storage file download')
  signal?.throwIfAborted()

  return buffer
}

/**
 * Result of {@link downloadServableFileFromStorage}: the bytes a consumer should
 * actually attach/upload, plus the content type that matches those bytes.
 */
export interface ServableFile {
  buffer: Buffer
  contentType: string
  contributingFiles?: readonly WorkspaceFileSecretProvenanceIdentity[]
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
 *
 * `maxBytes` is required for the reason given on {@link downloadFileFromStorage}: it
 * bounds the source read. A compiled artifact is re-checked against the same ceiling
 * below, since rendering can grow a small source into a large document.
 */
export async function downloadServableFileFromStorage(
  userFile: UserFile,
  requestId: string,
  logger: Logger,
  options: {
    maxBytes: number
    signal?: AbortSignal
    ownerKey?: string
    filePrincipal?: Principal
  }
): Promise<ServableFile> {
  const buffer = await downloadFileFromStorage(userFile, requestId, logger, {
    maxBytes: options.maxBytes,
    signal: options.signal,
  })

  // The pdf model for pages: a page file stores its source and downloads
  // resolve to the fully styled compiled document, like a .pdf key resolving
  // to its binary. Sim pages store an extensionless name (the record type
  // marks them); legacy pages still carry .html.
  if (userFile.name.toLowerCase().endsWith('.html') || userFile.type === SIM_PAGE_CONTENT_TYPE) {
    const text = buffer.toString('utf8')
    if (isSimPageSource(text)) {
      const workspaceId = userFile.key
        ? (parseWorkspaceFileKey(userFile.key) ?? undefined)
        : undefined
      const rendered = Buffer.from(
        await renderSimPageDocumentWithAssets(text, { workspaceId }),
        'utf8'
      )
      // Rendering inlines referenced assets, so a source well under the ceiling can
      // resolve to a document well over it.
      assertKnownSizeWithinLimit(rendered.length, options.maxBytes, 'servable page render')
      return { buffer: rendered, contentType: 'text/html' }
    }
  }

  // Cheap pre-filter so only generated-doc candidates pay for the heavier resolver
  // import below.
  if (!isRenderableDocumentName(userFile.name)) {
    const ext = getFileExtension(userFile.name)
    return { buffer, contentType: userFile.type || getMimeTypeFromExtension(ext) }
  }

  const workspaceId = userFile.key
    ? (parseWorkspaceFileKey(userFile.key) ??
      extractWorkspaceIdFromExecutionKey(userFile.key) ??
      undefined)
    : undefined

  const { resolveServableDocBytes } = await import(
    '@/lib/mothership/tools/server/files/doc-compile'
  )
  const resolved = await resolveServableDocBytes({
    rawBuffer: buffer,
    fileName: userFile.name,
    workspaceId,
    filePrincipal: options.filePrincipal,
    ownerKey: options.ownerKey,
    signal: options.signal,
  })

  // Re-check: the raw download enforced maxBytes on the source, but a generated doc
  // resolves to a larger artifact.
  assertKnownSizeWithinLimit(resolved.buffer.length, options.maxBytes, 'servable file download')

  return resolved
}

/**
 * Resolve every file of a multi-attachment request while bounding their COMBINED
 * resident size.
 *
 * A per-file ceiling is not enough when a request carries an array: N attachments
 * each just under the limit still cost N times the limit, and downloading them with
 * `Promise.all` makes that the peak. Routes that pre-checked `sum(file.size)` were
 * not protected either — the declared sizes come from the caller, which is why the
 * downloader re-checks the delivered bytes.
 *
 * So this walks the list in order against a shrinking budget: each file may only use
 * what the previous ones left. Sequential is the point — it is what keeps the peak at
 * `totalMaxBytes` instead of the sum, and attachment lists are short enough that the
 * lost parallelism does not register next to the provider round trip that follows.
 *
 * The overrun surfaces as a `PayloadSizeLimitError` restated in the caller's terms:
 * the per-file failure underneath reports one file against whatever budget was left,
 * which would read as a nonsense limit in a "total attachment size" message. `label`
 * and `totalMaxBytes` are the caller's, and `observedBytes` is what the set needed.
 */
export async function downloadServableFilesWithinBudget(
  userFiles: readonly UserFile[],
  requestId: string,
  logger: Logger,
  options: { totalMaxBytes: number; label: string; signal?: AbortSignal }
): Promise<ServableFile[]> {
  const resolved: ServableFile[] = []
  let spent = 0

  for (const userFile of userFiles) {
    logger.info(`[${requestId}] Downloading ${userFile.name} (${userFile.size} bytes)`)
    let servable: ServableFile
    try {
      servable = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes: options.totalMaxBytes - spent,
        signal: options.signal,
      })
    } catch (error) {
      if (!isPayloadSizeLimitError(error)) throw error
      throw new PayloadSizeLimitError({
        label: options.label,
        maxBytes: options.totalMaxBytes,
        observedBytes: spent + (error.observedBytes ?? userFile.size),
      })
    }
    spent += servable.buffer.length
    resolved.push(servable)
  }

  return resolved
}
