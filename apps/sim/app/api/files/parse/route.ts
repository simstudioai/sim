import { Buffer, isUtf8 } from 'buffer'
import { createHash } from 'crypto'
import fsPromises from 'fs/promises'
import path from 'path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import binaryExtensionsList from 'binary-extensions'
import { type NextRequest, NextResponse } from 'next/server'
import { fileParseContract } from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { isSupportedFileType, parseFile } from '@/lib/file-parsers'
import { isUsingCloudStorage, type StorageContext, StorageService } from '@/lib/uploads'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import {
  ExternalUrlValidationError,
  fetchExternalUrlToWorkspace,
} from '@/lib/uploads/contexts/workspace'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import {
  extractCleanFilename,
  extractStorageKey,
  extractWorkspaceIdFromExecutionKey,
  getMimeTypeFromExtension,
  getViewerUrl,
  inferContextFromKey,
  isInternalFileUrl,
} from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'
import '@/lib/uploads/core/setup.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesParseAPI')

const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
const DOWNLOAD_TIMEOUT_MS = 30000 // 30 seconds
const MAX_FILE_REFERENCE_LENGTH = 4096
const MAX_MULTI_FILE_PARSE_OUTPUT_BYTES = 5 * 1024 * 1024
const BINARY_EXTENSIONS = new Set<string>(binaryExtensionsList)

function isLikelyTextBuffer(fileBuffer: Buffer): boolean {
  return isUtf8(fileBuffer) && !fileBuffer.includes(0)
}

interface ExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

interface ParseResult {
  success: boolean
  content?: string
  error?: string
  filePath: string
  originalName?: string // Original filename from database (for workspace files)
  viewerUrl?: string | null // Viewer URL for the file if available
  userFile?: UserFile // UserFile object for the raw file
  metadata?: {
    fileType: string
    size: number
    hash: string
    processingTime: number
  }
}

function getContentBytes(content: unknown): number {
  return typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : 0
}

/**
 * Main API route handler
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const startTime = Date.now()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: true })

    if (!authResult.success) {
      logger.warn('Unauthorized file parse request', {
        error: authResult.error || 'Authentication failed',
      })
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    if (!authResult.userId) {
      logger.warn('File parse request missing userId', {
        authType: authResult.authType,
      })
      return NextResponse.json({ success: false, error: 'User context required' }, { status: 401 })
    }

    const userId = authResult.userId

    const parsed = await parseRequest(
      fileParseContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          const message = getValidationErrorMessage(error, 'Invalid request data')
          return NextResponse.json(
            {
              success: false,
              error: message,
              filePath: '',
            },
            { status: message.includes('At most 10 files') ? 413 : 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { filePath, fileType, headers, workspaceId, workflowId, executionId } = parsed.data.body

    if (!filePath || (typeof filePath === 'string' && filePath.trim() === '')) {
      return NextResponse.json({ success: false, error: 'No file path provided' }, { status: 400 })
    }

    // Build execution context if all required fields are present
    const executionContext: ExecutionContext | undefined =
      workspaceId && workflowId && executionId
        ? { workspaceId, workflowId, executionId }
        : undefined

    logger.info('File parse request received:', {
      filePath,
      fileType,
      workspaceId,
      userId,
      hasExecutionContext: !!executionContext,
      hasHeaders: Boolean(headers && Object.keys(headers).length > 0),
    })

    if (Array.isArray(filePath)) {
      const results = []
      let totalOutputBytes = 0

      for (const singlePath of filePath) {
        if (!singlePath || (typeof singlePath === 'string' && singlePath.trim() === '')) {
          results.push({
            success: false,
            error: 'Empty file path in array',
            filePath: singlePath || '',
          })
          continue
        }

        const remainingOutputBytes = MAX_MULTI_FILE_PARSE_OUTPUT_BYTES - totalOutputBytes
        if (remainingOutputBytes <= 0) {
          return parsedOutputTooLargeResponse(results)
        }

        const result = await parseFileSingle(
          singlePath,
          fileType,
          workspaceId,
          userId,
          executionContext,
          headers,
          request.signal,
          MAX_DOWNLOAD_SIZE_BYTES,
          remainingOutputBytes
        )
        if (result.metadata) {
          result.metadata.processingTime = Date.now() - startTime
        }

        if (result.success) {
          totalOutputBytes += getContentBytes(result.content)
          if (totalOutputBytes > MAX_MULTI_FILE_PARSE_OUTPUT_BYTES) {
            return parsedOutputTooLargeResponse(results)
          }

          const displayName =
            result.originalName || extractCleanFilename(result.filePath) || 'unknown'
          results.push({
            success: true,
            output: {
              content: result.content,
              name: displayName,
              fileType: result.metadata?.fileType || 'application/octet-stream',
              size: result.metadata?.size || 0,
              binary: false,
              file: result.userFile,
            },
            filePath: result.filePath,
            viewerUrl: result.viewerUrl,
          })
          continue
        }

        if (result.error?.startsWith('Parsed file output is too large')) {
          return parsedOutputTooLargeResponse(results)
        }

        results.push(result)
      }

      return NextResponse.json({
        success: true,
        results,
      })
    }

    const result = await parseFileSingle(
      filePath,
      fileType,
      workspaceId,
      userId,
      executionContext,
      headers,
      request.signal
    )

    if (result.metadata) {
      result.metadata.processingTime = Date.now() - startTime
    }

    if (result.success) {
      const displayName = result.originalName || extractCleanFilename(result.filePath) || 'unknown'
      return NextResponse.json({
        success: true,
        output: {
          content: result.content,
          name: displayName,
          fileType: result.metadata?.fileType || 'application/octet-stream',
          size: result.metadata?.size || 0,
          binary: false,
          file: result.userFile,
        },
        filePath: result.filePath,
        viewerUrl: result.viewerUrl,
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    logger.error('Error in file parse API:', error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Unknown error occurred'),
        filePath: '',
      },
      { status: 500 }
    )
  }
})

/**
 * Parse a single file and return its content
 */
async function parseFileSingle(
  filePath: string,
  fileType: string,
  workspaceId: string,
  userId: string,
  executionContext?: ExecutionContext,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  maxDownloadBytes = MAX_DOWNLOAD_SIZE_BYTES,
  maxParsedOutputBytes?: number
): Promise<ParseResult> {
  logger.info('Parsing file:', filePath)

  if (!filePath || filePath.trim() === '') {
    return {
      success: false,
      error: 'Empty file path provided',
      filePath: filePath || '',
    }
  }

  const referenceValidation = validateFileReferenceShape(filePath)
  if (!referenceValidation.isValid) {
    return {
      success: false,
      error: referenceValidation.error || 'Invalid file reference',
      filePath,
    }
  }

  const pathValidation = validateFilePath(filePath)
  if (!pathValidation.isValid) {
    return {
      success: false,
      error: pathValidation.error || 'Invalid path',
      filePath,
    }
  }

  if (isInternalFileUrl(filePath)) {
    return handleCloudFile(
      filePath,
      fileType,
      undefined,
      userId,
      executionContext,
      maxDownloadBytes,
      maxParsedOutputBytes
    )
  }

  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return handleExternalUrl(
      filePath,
      fileType,
      workspaceId,
      userId,
      executionContext,
      headers,
      signal,
      maxDownloadBytes,
      maxParsedOutputBytes
    )
  }

  if (isUsingCloudStorage()) {
    return handleCloudFile(
      filePath,
      fileType,
      undefined,
      userId,
      executionContext,
      maxDownloadBytes,
      maxParsedOutputBytes
    )
  }

  return handleLocalFile(
    filePath,
    fileType,
    userId,
    executionContext,
    maxDownloadBytes,
    maxParsedOutputBytes
  )
}

function validateFileReferenceShape(filePath: string): { isValid: boolean; error?: string } {
  const trimmed = filePath.trim()
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    isInternalFileUrl(trimmed)
  ) {
    return { isValid: true }
  }

  if (trimmed.startsWith('data:')) {
    return {
      isValid: false,
      error: 'File input must be a URL or uploaded file reference, not inline file content',
    }
  }

  if (filePath.length > MAX_FILE_REFERENCE_LENGTH) {
    return {
      isValid: false,
      error: 'File reference is too long; provide a file URL or upload the file instead',
    }
  }

  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(filePath)) {
    return {
      isValid: false,
      error:
        'File reference contains binary content; provide a file URL or upload the file instead',
    }
  }

  const newlineCount = filePath.match(/\r\n|\r|\n/g)?.length ?? 0
  if (newlineCount > 2) {
    return {
      isValid: false,
      error:
        'File reference looks like inline file content; provide a file URL or upload the file instead',
    }
  }

  return { isValid: true }
}

function parsedOutputTooLargeResponse(results?: unknown[]): NextResponse {
  const hasPartialResults = Boolean(results && results.length > 0)
  return NextResponse.json(
    {
      success: hasPartialResults,
      error: `Parsed file output is too large to return safely. Maximum combined parsed output is ${prettySize(
        MAX_MULTI_FILE_PARSE_OUTPUT_BYTES
      )}.`,
      ...(results && results.length > 0 ? { results } : {}),
    },
    { status: hasPartialResults ? 200 : 413 }
  )
}

function getParsedOutputTooLargeMessage(maxBytes: number): string {
  return `Parsed file output is too large to return safely. Maximum parsed output is ${prettySize(
    maxBytes
  )}.`
}

function assertParsedContentWithinLimit(content: string, maxBytes?: number): string {
  if (maxBytes !== undefined) {
    assertKnownSizeWithinLimit(Buffer.byteLength(content, 'utf8'), maxBytes, 'parsed file output')
  }
  return content
}

/**
 * Validate file path for security - prevents null byte injection and path traversal attacks.
 *
 * External URLs (`http`/`https`) are fetched over HTTP — with SSRF protection applied
 * downstream in `fetchExternalUrlToWorkspace` (DNS resolution + private/reserved IP blocking)
 * — and are never resolved against the filesystem, so `..`/`~` are legal URL content and must
 * not be rejected. Providers such as Slack routinely emit slugs containing a literal `...`.
 *
 * Internal file URLs (`/api/files/serve/...`) ARE resolved to storage keys and filesystem
 * paths via `extractStorageKey`, so they keep full traversal protection. The external
 * short-circuit explicitly excludes them: `parseFileSingle` routes anything matching
 * `isInternalFileUrl` to `handleCloudFile` (even an absolute `https://host/api/files/serve/...`),
 * so such inputs must stay subject to the `..`/`~` checks rather than being waved through as
 * external URLs. Only the leading-`/` "outside allowed directory" check is relaxed for them,
 * since that prefix is expected.
 */
function validateFilePath(filePath: string): { isValid: boolean; error?: string } {
  if (filePath.includes('\0')) {
    return { isValid: false, error: 'Invalid path: null byte detected' }
  }

  if (
    (filePath.startsWith('http://') || filePath.startsWith('https://')) &&
    !isInternalFileUrl(filePath)
  ) {
    return { isValid: true }
  }

  if (filePath.includes('..')) {
    return { isValid: false, error: 'Access denied: path traversal detected' }
  }

  if (filePath.includes('~')) {
    return { isValid: false, error: 'Invalid path: tilde character not allowed' }
  }

  if (filePath.startsWith('/') && !isInternalFileUrl(filePath)) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }

  if (/^[A-Za-z]:\\/.test(filePath)) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }

  return { isValid: true }
}

/**
 * Handle external URL.
 *
 * Always fetches the URL fresh — there is no filename-based dedup. Distinct URLs
 * commonly share a path tail (e.g. every Slack clipboard paste is `image.png`),
 * so keying a cache by filename returns stale bytes. `fetchExternalUrlToWorkspace`
 * delegates to `uploadWorkspaceFile`, which suffix-disambiguates collisions on save.
 *
 * Workspace save is skipped when the URL already points at our execution-files
 * bucket (re-uploading our own bytes is wasteful and would generate `image (1).png`
 * style aliases for files we already own).
 */
async function handleExternalUrl(
  url: string,
  fileType: string,
  workspaceId: string,
  userId: string,
  executionContext?: ExecutionContext,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  maxDownloadBytes = MAX_DOWNLOAD_SIZE_BYTES,
  maxParsedOutputBytes?: number
): Promise<ParseResult> {
  try {
    logger.info('Fetching external URL:', url)

    const {
      S3_EXECUTION_FILES_CONFIG,
      BLOB_EXECUTION_FILES_CONFIG,
      USE_S3_STORAGE,
      USE_BLOB_STORAGE,
    } = await import('@/lib/uploads/config')

    let isExecutionFile = false
    try {
      const parsedUrl = new URL(url)

      if (USE_S3_STORAGE && S3_EXECUTION_FILES_CONFIG.bucket) {
        const bucketInHost = parsedUrl.hostname.startsWith(S3_EXECUTION_FILES_CONFIG.bucket)
        const bucketInPath = parsedUrl.pathname.startsWith(`/${S3_EXECUTION_FILES_CONFIG.bucket}/`)
        isExecutionFile = bucketInHost || bucketInPath
      } else if (USE_BLOB_STORAGE && BLOB_EXECUTION_FILES_CONFIG.containerName) {
        isExecutionFile = url.includes(`/${BLOB_EXECUTION_FILES_CONFIG.containerName}/`)
      }
    } catch (error) {
      logger.warn('Failed to parse URL for execution file check:', error)
      isExecutionFile = false
    }

    const { filename, buffer, mimeType } = await fetchExternalUrlToWorkspace({
      url,
      userId,
      workspaceId: workspaceId || undefined,
      saveToWorkspace: Boolean(workspaceId) && !isExecutionFile,
      headers,
      signal,
      maxDownloadBytes,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    })
    const extension = path.extname(filename).toLowerCase().substring(1)

    logger.info(`Downloaded file from URL: ${url}, size: ${buffer.length} bytes`)

    let userFile: UserFile | undefined
    if (executionContext) {
      try {
        userFile = await uploadExecutionFile(executionContext, buffer, filename, mimeType, userId)
        logger.info(`Stored file in execution storage: ${filename}`, { key: userFile.key })
      } catch (uploadError) {
        logger.warn('Failed to store file in execution storage:', uploadError)
      }
    }

    let parseResult: ParseResult
    if (extension === 'pdf') {
      parseResult = await handlePdfBuffer(buffer, filename, fileType, url, maxParsedOutputBytes)
    } else if (extension === 'csv') {
      parseResult = await handleCsvBuffer(buffer, filename, fileType, url, maxParsedOutputBytes)
    } else if (isSupportedFileType(extension)) {
      parseResult = await handleGenericTextBuffer(
        buffer,
        filename,
        extension,
        fileType,
        url,
        maxParsedOutputBytes
      )
    } else {
      parseResult = handleGenericBuffer(buffer, filename, extension, fileType, maxParsedOutputBytes)
    }

    // Attach userFile to the result
    if (userFile) {
      parseResult.userFile = userFile
    }

    return parseResult
  } catch (error) {
    logger.error(`Error handling external URL ${sanitizeUrlForLog(url)}:`, error)
    if (isPayloadSizeLimitError(error)) {
      logger.warn('Rejected oversized external file parse payload', {
        maxBytes: error.maxBytes,
        observedBytes: error.observedBytes,
        label: error.label,
        url: sanitizeUrlForLog(url),
      })
      return {
        success: false,
        error:
          error.label === 'parsed file output'
            ? getParsedOutputTooLargeMessage(error.maxBytes)
            : `File is too large to parse safely. Maximum supported download size is ${prettySize(
                error.maxBytes
              )}.`,
        filePath: url,
      }
    }

    if (error instanceof ExternalUrlValidationError) {
      logger.warn(`Blocked external URL request: ${error.message}`)
      return {
        success: false,
        error: error.message,
        filePath: url,
      }
    }

    return {
      success: false,
      error: `Error fetching URL: ${(error as Error).message}`,
      filePath: url,
    }
  }
}

/**
 * Handle file stored in cloud storage
 * If executionContext is provided and file is not already from execution storage,
 * copies the file to execution storage and returns UserFile
 */
async function handleCloudFile(
  filePath: string,
  fileType: string,
  explicitContext: string | undefined,
  userId: string,
  executionContext?: ExecutionContext,
  maxDownloadBytes = MAX_DOWNLOAD_SIZE_BYTES,
  maxParsedOutputBytes?: number
): Promise<ParseResult> {
  try {
    const cloudKey = extractStorageKey(filePath)

    logger.info('Extracted cloud key:', cloudKey)

    const context = (explicitContext as StorageContext) || inferContextFromKey(cloudKey)

    const hasAccess = await verifyFileAccess(
      cloudKey,
      userId,
      undefined, // customConfig
      context, // context
      false // isLocal
    )

    if (!hasAccess) {
      logger.warn('Unauthorized cloud file parse attempt', { userId, key: cloudKey, context })
      return {
        success: false,
        error: 'File not found',
        filePath,
      }
    }

    let originalFilename: string | undefined
    if (context === 'workspace') {
      try {
        const fileRecord = await getFileMetadataByKey(cloudKey, 'workspace')

        if (fileRecord) {
          originalFilename = fileRecord.originalName
          logger.debug(`Found original filename for workspace file: ${originalFilename}`)
        }
      } catch (dbError) {
        logger.debug(`Failed to lookup original filename for ${cloudKey}:`, dbError)
      }
    }

    const fileBuffer = await StorageService.downloadFile({
      key: cloudKey,
      context,
      maxBytes: maxDownloadBytes,
    })
    logger.info(
      `Downloaded file from ${context} storage (${explicitContext ? 'explicit' : 'inferred'}): ${cloudKey}, size: ${fileBuffer.length} bytes`
    )

    const filename = originalFilename || cloudKey.split('/').pop() || cloudKey
    const extension = path.extname(filename).toLowerCase().substring(1)
    const mimeType = getMimeTypeFromExtension(extension)

    const normalizedFilePath = `/api/files/serve/${encodeURIComponent(cloudKey)}?context=${context}`
    let workspaceIdFromKey: string | undefined

    if (context === 'execution') {
      workspaceIdFromKey = extractWorkspaceIdFromExecutionKey(cloudKey) || undefined
    } else if (context === 'workspace') {
      const segments = cloudKey.split('/')
      if (segments.length >= 2 && /^[a-f0-9-]{36}$/.test(segments[0])) {
        workspaceIdFromKey = segments[0]
      }
    }

    const viewerUrl = getViewerUrl(cloudKey, workspaceIdFromKey)

    // Store file in execution storage if executionContext is provided
    let userFile: UserFile | undefined

    if (executionContext) {
      // If file is already from execution context, create UserFile reference without re-uploading
      if (context === 'execution') {
        userFile = {
          id: `file_${Date.now()}_${generateShortId(7)}`,
          name: filename,
          url: normalizedFilePath,
          size: fileBuffer.length,
          type: mimeType,
          key: cloudKey,
          context: 'execution',
        }
        logger.info(`Created UserFile reference for existing execution file: ${filename}`)
      } else {
        // Copy from workspace/other storage to execution storage
        try {
          userFile = await uploadExecutionFile(
            executionContext,
            fileBuffer,
            filename,
            mimeType,
            userId
          )
          logger.info(`Copied file to execution storage: ${filename}`, { key: userFile.key })
        } catch (uploadError) {
          logger.warn(`Failed to copy file to execution storage:`, uploadError)
        }
      }
    }

    let parseResult: ParseResult
    if (extension === 'pdf') {
      parseResult = await handlePdfBuffer(
        fileBuffer,
        filename,
        fileType,
        normalizedFilePath,
        maxParsedOutputBytes
      )
    } else if (extension === 'csv') {
      parseResult = await handleCsvBuffer(
        fileBuffer,
        filename,
        fileType,
        normalizedFilePath,
        maxParsedOutputBytes
      )
    } else if (isSupportedFileType(extension)) {
      parseResult = await handleGenericTextBuffer(
        fileBuffer,
        filename,
        extension,
        fileType,
        normalizedFilePath,
        maxParsedOutputBytes
      )
    } else {
      parseResult = handleGenericBuffer(
        fileBuffer,
        filename,
        extension,
        fileType,
        maxParsedOutputBytes
      )
      parseResult.filePath = normalizedFilePath
    }

    if (originalFilename) {
      parseResult.originalName = originalFilename
    }

    parseResult.viewerUrl = viewerUrl

    // Attach userFile to the result
    if (userFile) {
      parseResult.userFile = userFile
    }

    return parseResult
  } catch (error) {
    logger.error(`Error handling cloud file ${filePath}:`, error)

    const errorMessage = (error as Error).message
    if (isPayloadSizeLimitError(error)) {
      logger.warn('Rejected oversized cloud file parse payload', {
        maxBytes: error.maxBytes,
        observedBytes: error.observedBytes,
        label: error.label,
        filePath,
      })
      return {
        success: false,
        error:
          error.label === 'parsed file output'
            ? getParsedOutputTooLargeMessage(error.maxBytes)
            : `File is too large to parse safely. Maximum supported download size is ${prettySize(
                error.maxBytes
              )}.`,
        filePath,
      }
    }

    if (errorMessage.includes('Access denied') || errorMessage.includes('Forbidden')) {
      throw new Error(`Error accessing file from cloud storage: ${errorMessage}`)
    }

    return {
      success: false,
      error: `Error accessing file from cloud storage: ${errorMessage}`,
      filePath,
    }
  }
}

/**
 * Handle local file
 */
async function handleLocalFile(
  filePath: string,
  fileType: string,
  userId: string,
  executionContext?: ExecutionContext,
  maxDownloadBytes = MAX_DOWNLOAD_SIZE_BYTES,
  maxParsedOutputBytes?: number
): Promise<ParseResult> {
  try {
    const storageKey = isInternalFileUrl(filePath) ? extractStorageKey(filePath) : filePath
    const filename = storageKey.split('/').pop() || storageKey

    const context = inferContextFromKey(storageKey)
    const hasAccess = await verifyFileAccess(
      storageKey,
      userId,
      undefined, // customConfig
      context, // context
      true // isLocal
    )

    if (!hasAccess) {
      logger.warn('Unauthorized local file parse attempt', { userId, filename })
      return {
        success: false,
        error: 'File not found',
        filePath,
      }
    }

    const fullPath = path.join(UPLOAD_DIR_SERVER, storageKey)

    logger.info('Processing local file:', fullPath)

    try {
      await fsPromises.access(fullPath)
    } catch {
      throw new Error(`File not found: ${filename}`)
    }

    const stats = await fsPromises.stat(fullPath)
    assertKnownSizeWithinLimit(stats.size, maxDownloadBytes, 'local file')

    const result = await parseFile(fullPath)
    const content = assertParsedContentWithinLimit(result.content, maxParsedOutputBytes)
    const fileBuffer = await fsPromises.readFile(fullPath)
    const hash = createHash('md5').update(fileBuffer).digest('hex')

    const extension = path.extname(filename).toLowerCase().substring(1)
    const mimeType = fileType || getMimeTypeFromExtension(extension)

    // Store file in execution storage if executionContext is provided
    let userFile: UserFile | undefined
    if (executionContext) {
      try {
        userFile = await uploadExecutionFile(
          executionContext,
          fileBuffer,
          filename,
          mimeType,
          userId
        )
        logger.info(`Stored local file in execution storage: ${filename}`, { key: userFile.key })
      } catch (uploadError) {
        logger.warn(`Failed to store local file in execution storage:`, uploadError)
      }
    }

    return {
      success: true,
      content,
      filePath,
      userFile,
      metadata: {
        fileType: mimeType,
        size: stats.size,
        hash,
        processingTime: 0,
      },
    }
  } catch (error) {
    logger.error(`Error handling local file ${filePath}:`, error)
    if (isPayloadSizeLimitError(error)) {
      logger.warn('Rejected oversized local file parse payload', {
        maxBytes: error.maxBytes,
        observedBytes: error.observedBytes,
        label: error.label,
        filePath,
      })
      return {
        success: false,
        error:
          error.label === 'parsed file output'
            ? getParsedOutputTooLargeMessage(error.maxBytes)
            : `File is too large to parse safely. Maximum supported local file size is ${prettySize(
                error.maxBytes
              )}.`,
        filePath,
      }
    }

    return {
      success: false,
      error: `Error processing local file: ${(error as Error).message}`,
      filePath,
    }
  }
}

/**
 * Handle a PDF buffer directly in memory
 */
async function handlePdfBuffer(
  fileBuffer: Buffer,
  filename: string,
  fileType?: string,
  originalPath?: string,
  maxParsedOutputBytes?: number
): Promise<ParseResult> {
  try {
    logger.info(`Parsing PDF in memory: ${filename}`)

    const result = await parseBufferAsPdf(fileBuffer)

    const content =
      result.content ||
      createPdfFallbackMessage(result.metadata?.pageCount || 0, fileBuffer.length, originalPath)
    const limitedContent = assertParsedContentWithinLimit(content, maxParsedOutputBytes)

    return {
      success: true,
      content: limitedContent,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || 'application/pdf',
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw error

    logger.error('Failed to parse PDF in memory:', error)

    const content = createPdfFailureMessage(
      0,
      fileBuffer.length,
      originalPath || filename,
      (error as Error).message
    )

    return {
      success: true,
      content,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || 'application/pdf',
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  }
}

/**
 * Handle a CSV buffer directly in memory
 */
async function handleCsvBuffer(
  fileBuffer: Buffer,
  filename: string,
  fileType?: string,
  originalPath?: string,
  maxParsedOutputBytes?: number
): Promise<ParseResult> {
  try {
    logger.info(`Parsing CSV in memory: ${filename}`)

    const { parseBuffer } = await import('@/lib/file-parsers')
    const result = await parseBuffer(fileBuffer, 'csv')

    return {
      success: true,
      content: assertParsedContentWithinLimit(result.content, maxParsedOutputBytes),
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || 'text/csv',
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw error

    logger.error('Failed to parse CSV in memory:', error)
    return {
      success: false,
      error: `Failed to parse CSV: ${(error as Error).message}`,
      filePath: originalPath || filename,
      metadata: {
        fileType: 'text/csv',
        size: 0,
        hash: '',
        processingTime: 0,
      },
    }
  }
}

/**
 * Handle a generic text file buffer in memory
 */
async function handleGenericTextBuffer(
  fileBuffer: Buffer,
  filename: string,
  extension: string,
  fileType?: string,
  originalPath?: string,
  maxParsedOutputBytes?: number
): Promise<ParseResult> {
  try {
    logger.info(`Parsing text file in memory: ${filename}`)

    try {
      const { parseBuffer, isSupportedFileType } = await import('@/lib/file-parsers')

      if (isSupportedFileType(extension)) {
        const result = await parseBuffer(fileBuffer, extension)

        return {
          success: true,
          content: assertParsedContentWithinLimit(result.content, maxParsedOutputBytes),
          filePath: originalPath || filename,
          metadata: {
            fileType: fileType || getMimeTypeFromExtension(extension),
            size: fileBuffer.length,
            hash: createHash('md5').update(fileBuffer).digest('hex'),
            processingTime: 0,
          },
        }
      }
    } catch (parserError) {
      if (isPayloadSizeLimitError(parserError)) throw parserError

      logger.warn('Specialized parser failed, falling back to generic parsing:', parserError)
    }

    const content = fileBuffer.toString('utf-8')
    const limitedContent = assertParsedContentWithinLimit(content, maxParsedOutputBytes)

    return {
      success: true,
      content: limitedContent,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || getMimeTypeFromExtension(extension),
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw error

    logger.error('Failed to parse text file in memory:', error)
    return {
      success: false,
      error: `Failed to parse file: ${(error as Error).message}`,
      filePath: originalPath || filename,
      metadata: {
        fileType: 'text/plain',
        size: 0,
        hash: '',
        processingTime: 0,
      },
    }
  }
}

/**
 * Handle a generic binary buffer
 */
function handleGenericBuffer(
  fileBuffer: Buffer,
  filename: string,
  extension: string,
  fileType?: string,
  maxParsedOutputBytes?: number
): ParseResult {
  const normalizedExtension = extension.toLowerCase()
  const content =
    !BINARY_EXTENSIONS.has(normalizedExtension) && isLikelyTextBuffer(fileBuffer)
      ? assertParsedContentWithinLimit(fileBuffer.toString('utf-8'), maxParsedOutputBytes)
      : `[Binary ${normalizedExtension.toUpperCase()} file - ${fileBuffer.length} bytes]`

  return {
    success: true,
    content,
    filePath: filename,
    metadata: {
      fileType: fileType || getMimeTypeFromExtension(extension),
      size: fileBuffer.length,
      hash: createHash('md5').update(fileBuffer).digest('hex'),
      processingTime: 0,
    },
  }
}

/**
 * Parse a PDF buffer
 */
async function parseBufferAsPdf(buffer: Buffer) {
  try {
    const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')
    const parser = new PdfParser()
    logger.info('Using main PDF parser for buffer')

    return await parser.parseBuffer(buffer)
  } catch (error) {
    throw new Error(`PDF parsing failed: ${(error as Error).message}`)
  }
}

/**
 * Format bytes to human readable size
 */
function prettySize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${Number.parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`
}

/**
 * Create a formatted message for PDF content
 */
function createPdfFallbackMessage(pageCount: number, size: number, path?: string): string {
  const formattedPath = path || 'Unknown path'

  return `PDF document - ${pageCount} page(s), ${prettySize(size)}
Path: ${formattedPath}

This file appears to be a PDF document that could not be fully processed as text.
Please use a PDF viewer for best results.`
}

/**
 * Create error message for PDF parsing failure and make it more readable
 */
function createPdfFailureMessage(
  pageCount: number,
  size: number,
  path: string,
  error: string
): string {
  return `PDF document - Processing failed, ${prettySize(size)}
Path: ${path}
Error: ${error}

This file appears to be a PDF document that could not be processed.
Please use a PDF viewer for best results.`
}
