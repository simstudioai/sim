import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import fsPromises, { readFile } from 'fs/promises'
import path from 'path'
import binaryExtensionsList from 'binary-extensions'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { isSupportedFileType, parseFile } from '@/lib/file-parsers'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { validateExternalUrl } from '@/lib/security/input-validation'
import { isUsingCloudStorage, type StorageContext, StorageService } from '@/lib/uploads'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import {
  extractCleanFilename,
  extractStorageKey,
  extractWorkspaceIdFromExecutionKey,
  getViewerUrl,
  inferContextFromKey,
} from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import '@/lib/uploads/core/setup.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesParseAPI')

const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
const DOWNLOAD_TIMEOUT_MS = 30000 // 30 seconds

interface ParseResult {
  success: boolean
  content?: string
  error?: string
  filePath: string
  originalName?: string // Original filename from database (for workspace files)
  viewerUrl?: string | null // Viewer URL for the file if available
  metadata?: {
    fileType: string
    size: number
    hash: string
    processingTime: number
  }
}

const fileTypeMap: Record<string, string> = {
  // Text formats
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  md: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/typescript',
  // Document formats
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Spreadsheet formats
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Presentation formats
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Image formats
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  // Archive formats
  zip: 'application/zip',
}

/**
 * Main API route handler
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: true })

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
    const requestData = await request.json()
    const { filePath, fileType, workspaceId } = requestData

    if (!filePath || (typeof filePath === 'string' && filePath.trim() === '')) {
      return NextResponse.json({ success: false, error: 'No file path provided' }, { status: 400 })
    }

    logger.info('File parse request received:', { filePath, fileType, workspaceId, userId })

    if (Array.isArray(filePath)) {
      const results = []
      for (const path of filePath) {
        if (!path || (typeof path === 'string' && path.trim() === '')) {
          results.push({
            success: false,
            error: 'Empty file path in array',
            filePath: path || '',
          })
          continue
        }

        const result = await parseFileSingle(path, fileType, workspaceId, userId)
        if (result.metadata) {
          result.metadata.processingTime = Date.now() - startTime
        }

        if (result.success) {
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
            },
            filePath: result.filePath,
            viewerUrl: result.viewerUrl,
          })
        } else {
          results.push(result)
        }
      }

      return NextResponse.json({
        success: true,
        results,
      })
    }

    const result = await parseFileSingle(filePath, fileType, workspaceId, userId)

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
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        filePath: '',
      },
      { status: 500 }
    )
  }
}

/**
 * Parse a single file and return its content
 */
async function parseFileSingle(
  filePath: string,
  fileType: string,
  workspaceId: string,
  userId: string
): Promise<ParseResult> {
  logger.info('Parsing file:', filePath)

  if (!filePath || filePath.trim() === '') {
    return {
      success: false,
      error: 'Empty file path provided',
      filePath: filePath || '',
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

  if (filePath.includes('/api/files/serve/')) {
    return handleCloudFile(filePath, fileType, undefined, userId)
  }

  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return handleExternalUrl(filePath, fileType, workspaceId, userId)
  }

  if (isUsingCloudStorage()) {
    return handleCloudFile(filePath, fileType, undefined, userId)
  }

  return handleLocalFile(filePath, fileType, userId)
}

/**
 * Validate file path for security - prevents null byte injection and path traversal attacks
 */
function validateFilePath(filePath: string): { isValid: boolean; error?: string } {
  if (filePath.includes('\0')) {
    return { isValid: false, error: 'Invalid path: null byte detected' }
  }

  if (filePath.includes('..')) {
    return { isValid: false, error: 'Access denied: path traversal detected' }
  }

  if (filePath.includes('~')) {
    return { isValid: false, error: 'Invalid path: tilde character not allowed' }
  }

  if (filePath.startsWith('/') && !filePath.startsWith('/api/files/serve/')) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }

  if (/^[A-Za-z]:\\/.test(filePath)) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }

  return { isValid: true }
}

/**
 * Handle external URL
 * If workspaceId is provided, checks if file already exists and saves to workspace if not
 */
async function handleExternalUrl(
  url: string,
  fileType: string,
  workspaceId: string,
  userId: string
): Promise<ParseResult> {
  try {
    logger.info('Fetching external URL:', url)
    logger.info('WorkspaceId for URL save:', workspaceId)

    const urlValidation = validateExternalUrl(url, 'fileUrl')
    if (!urlValidation.isValid) {
      logger.warn(`Blocked external URL request: ${urlValidation.error}`)
      return {
        success: false,
        error: urlValidation.error || 'Invalid external URL',
        filePath: url,
      }
    }

    const urlPath = new URL(url).pathname
    const filename = urlPath.split('/').pop() || 'download'
    const extension = path.extname(filename).toLowerCase().substring(1)

    logger.info(`Extracted filename: ${filename}, workspaceId: ${workspaceId}`)

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

    // Only apply workspace deduplication if:
    // 1. WorkspaceId is provided
    // 2. URL is NOT from execution files bucket/container
    const shouldCheckWorkspace = workspaceId && !isExecutionFile

    if (shouldCheckWorkspace) {
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission === null) {
        logger.warn('User does not have workspace access for file parse', {
          userId,
          workspaceId,
          filename,
        })
        return {
          success: false,
          error: 'File not found',
          filePath: url,
        }
      }

      const { fileExistsInWorkspace, listWorkspaceFiles } = await import(
        '@/lib/uploads/contexts/workspace'
      )
      const exists = await fileExistsInWorkspace(workspaceId, filename)

      if (exists) {
        logger.info(`File ${filename} already exists in workspace, using existing file`)
        const workspaceFiles = await listWorkspaceFiles(workspaceId)
        const existingFile = workspaceFiles.find((f) => f.name === filename)

        if (existingFile) {
          const storageFilePath = `/api/files/serve/${existingFile.key}`
          return handleCloudFile(storageFilePath, fileType, 'workspace', userId)
        }
      }
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength) > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`File too large: ${contentLength} bytes (max: ${MAX_DOWNLOAD_SIZE_BYTES})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    if (buffer.length > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`File too large: ${buffer.length} bytes (max: ${MAX_DOWNLOAD_SIZE_BYTES})`)
    }

    logger.info(`Downloaded file from URL: ${url}, size: ${buffer.length} bytes`)

    if (shouldCheckWorkspace) {
      try {
        const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
        if (permission !== 'admin' && permission !== 'write') {
          logger.warn('User does not have write permission for workspace file save', {
            userId,
            workspaceId,
            filename,
            permission,
          })
        } else {
          const { uploadWorkspaceFile } = await import('@/lib/uploads/contexts/workspace')
          const mimeType = response.headers.get('content-type') || getMimeType(extension)
          await uploadWorkspaceFile(workspaceId, userId, buffer, filename, mimeType)
          logger.info(`Saved URL file to workspace storage: ${filename}`)
        }
      } catch (saveError) {
        logger.warn(`Failed to save URL file to workspace:`, saveError)
      }
    }

    if (extension === 'pdf') {
      return await handlePdfBuffer(buffer, filename, fileType, url)
    }
    if (extension === 'csv') {
      return await handleCsvBuffer(buffer, filename, fileType, url)
    }
    if (isSupportedFileType(extension)) {
      return await handleGenericTextBuffer(buffer, filename, extension, fileType, url)
    }

    return handleGenericBuffer(buffer, filename, extension, fileType)
  } catch (error) {
    logger.error(`Error handling external URL ${url}:`, error)
    return {
      success: false,
      error: `Error fetching URL: ${(error as Error).message}`,
      filePath: url,
    }
  }
}

/**
 * Handle file stored in cloud storage
 */
async function handleCloudFile(
  filePath: string,
  fileType: string,
  explicitContext: string | undefined,
  userId: string
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

    const fileBuffer = await StorageService.downloadFile({ key: cloudKey, context })
    logger.info(
      `Downloaded file from ${context} storage (${explicitContext ? 'explicit' : 'inferred'}): ${cloudKey}, size: ${fileBuffer.length} bytes`
    )

    const filename = originalFilename || cloudKey.split('/').pop() || cloudKey
    const extension = path.extname(filename).toLowerCase().substring(1)

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

    let parseResult: ParseResult
    if (extension === 'pdf') {
      parseResult = await handlePdfBuffer(fileBuffer, filename, fileType, normalizedFilePath)
    } else if (extension === 'csv') {
      parseResult = await handleCsvBuffer(fileBuffer, filename, fileType, normalizedFilePath)
    } else if (isSupportedFileType(extension)) {
      parseResult = await handleGenericTextBuffer(
        fileBuffer,
        filename,
        extension,
        fileType,
        normalizedFilePath
      )
    } else {
      parseResult = handleGenericBuffer(fileBuffer, filename, extension, fileType)
      parseResult.filePath = normalizedFilePath
    }

    if (originalFilename) {
      parseResult.originalName = originalFilename
    }

    parseResult.viewerUrl = viewerUrl

    return parseResult
  } catch (error) {
    logger.error(`Error handling cloud file ${filePath}:`, error)

    const errorMessage = (error as Error).message
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
  userId: string
): Promise<ParseResult> {
  try {
    const filename = filePath.split('/').pop() || filePath

    const context = inferContextFromKey(filename)
    const hasAccess = await verifyFileAccess(
      filename,
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

    const fullPath = path.join(UPLOAD_DIR_SERVER, filename)

    logger.info('Processing local file:', fullPath)

    try {
      await fsPromises.access(fullPath)
    } catch {
      throw new Error(`File not found: ${filename}`)
    }

    const result = await parseFile(fullPath)

    const stats = await fsPromises.stat(fullPath)
    const fileBuffer = await readFile(fullPath)
    const hash = createHash('md5').update(fileBuffer).digest('hex')

    const extension = path.extname(filename).toLowerCase().substring(1)

    return {
      success: true,
      content: result.content,
      filePath,
      metadata: {
        fileType: fileType || getMimeType(extension),
        size: stats.size,
        hash,
        processingTime: 0,
      },
    }
  } catch (error) {
    logger.error(`Error handling local file ${filePath}:`, error)
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
  originalPath?: string
): Promise<ParseResult> {
  try {
    logger.info(`Parsing PDF in memory: ${filename}`)

    const result = await parseBufferAsPdf(fileBuffer)

    const content =
      result.content ||
      createPdfFallbackMessage(result.metadata?.pageCount || 0, fileBuffer.length, originalPath)

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
  } catch (error) {
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
  originalPath?: string
): Promise<ParseResult> {
  try {
    logger.info(`Parsing CSV in memory: ${filename}`)

    const { parseBuffer } = await import('@/lib/file-parsers')
    const result = await parseBuffer(fileBuffer, 'csv')

    return {
      success: true,
      content: result.content,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || 'text/csv',
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
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
  originalPath?: string
): Promise<ParseResult> {
  try {
    logger.info(`Parsing text file in memory: ${filename}`)

    try {
      const { parseBuffer, isSupportedFileType } = await import('@/lib/file-parsers')

      if (isSupportedFileType(extension)) {
        const result = await parseBuffer(fileBuffer, extension)

        return {
          success: true,
          content: result.content,
          filePath: originalPath || filename,
          metadata: {
            fileType: fileType || getMimeType(extension),
            size: fileBuffer.length,
            hash: createHash('md5').update(fileBuffer).digest('hex'),
            processingTime: 0,
          },
        }
      }
    } catch (parserError) {
      logger.warn('Specialized parser failed, falling back to generic parsing:', parserError)
    }

    const content = fileBuffer.toString('utf-8')

    return {
      success: true,
      content,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || getMimeType(extension),
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
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
  fileType?: string
): ParseResult {
  const isBinary = binaryExtensionsList.includes(extension)
  const content = isBinary
    ? `[Binary ${extension.toUpperCase()} file - ${fileBuffer.length} bytes]`
    : fileBuffer.toString('utf-8')

  return {
    success: true,
    content,
    filePath: filename,
    metadata: {
      fileType: fileType || getMimeType(extension),
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
 * Get MIME type from file extension
 */
function getMimeType(extension: string): string {
  return fileTypeMap[extension] || 'application/octet-stream'
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
