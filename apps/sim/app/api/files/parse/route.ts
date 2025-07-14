import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import fsPromises, { readFile } from 'fs/promises'
import path from 'path'
import binaryExtensionsList from 'binary-extensions'
import { type NextRequest, NextResponse } from 'next/server'
import { isSupportedFileType, parseFile } from '@/lib/file-parsers'
import { createLogger } from '@/lib/logs/console-logger'
import { downloadFile, isUsingCloudStorage } from '@/lib/uploads'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesParseAPI')

const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
const DOWNLOAD_TIMEOUT_MS = 30000 // 30 seconds

interface ParseResult {
  success: boolean
  content?: string
  error?: string
  filePath: string
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
    const requestData = await request.json()
    const { filePath, fileType } = requestData

    if (!filePath) {
      return NextResponse.json({ success: false, error: 'No file path provided' }, { status: 400 })
    }

    logger.info('File parse request received:', { filePath, fileType })

    // Handle multiple files
    if (Array.isArray(filePath)) {
      const results = []
      for (const path of filePath) {
        const result = await parseFileSingle(path, fileType)
        // Add processing time to metadata
        if (result.metadata) {
          result.metadata.processingTime = Date.now() - startTime
        }

        // Transform each result to match expected frontend format
        if (result.success) {
          results.push({
            success: true,
            output: {
              content: result.content,
              name: result.filePath.split('/').pop() || 'unknown',
              fileType: result.metadata?.fileType || 'application/octet-stream',
              size: result.metadata?.size || 0,
              binary: false, // We only return text content
            },
            filePath: result.filePath,
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

    // Handle single file
    const result = await parseFileSingle(filePath, fileType)

    // Add processing time to metadata
    if (result.metadata) {
      result.metadata.processingTime = Date.now() - startTime
    }

    // Transform single file result to match expected frontend format
    if (result.success) {
      return NextResponse.json({
        success: true,
        output: {
          content: result.content,
          name: result.filePath.split('/').pop() || 'unknown',
          fileType: result.metadata?.fileType || 'application/octet-stream',
          size: result.metadata?.size || 0,
          binary: false, // We only return text content
        },
      })
    }

    // Only return 500 for actual server errors, not file processing failures
    // File processing failures (like file not found, parsing errors) should return 200 with success:false
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
async function parseFileSingle(filePath: string, fileType?: string): Promise<ParseResult> {
  logger.info('Parsing file:', filePath)

  // Validate path for security before any processing
  const pathValidation = validateFilePath(filePath)
  if (!pathValidation.isValid) {
    return {
      success: false,
      error: pathValidation.error || 'Invalid path',
      filePath,
    }
  }

  // Check if this is an external URL
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return handleExternalUrl(filePath, fileType)
  }

  // Check if this is a cloud storage path (S3 or Blob)
  const isS3Path = filePath.includes('/api/files/serve/s3/')
  const isBlobPath = filePath.includes('/api/files/serve/blob/')

  // Use cloud handler if it's a cloud path or we're in cloud mode
  if (isS3Path || isBlobPath || isUsingCloudStorage()) {
    return handleCloudFile(filePath, fileType)
  }

  // Use local handler for local files
  return handleLocalFile(filePath, fileType)
}

/**
 * Validate file path for security
 */
function validateFilePath(filePath: string): { isValid: boolean; error?: string } {
  // Check for null bytes
  if (filePath.includes('\0')) {
    return { isValid: false, error: 'Invalid path: null byte detected' }
  }

  // Check for path traversal attempts
  if (filePath.includes('..')) {
    return { isValid: false, error: 'Access denied: path traversal detected' }
  }

  // Check for tilde characters (home directory access)
  if (filePath.includes('~')) {
    return { isValid: false, error: 'Invalid path: tilde character not allowed' }
  }

  // Check for absolute paths outside allowed directories
  if (filePath.startsWith('/') && !filePath.startsWith('/api/files/serve/')) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }

  // Check for Windows absolute paths
  if (/^[A-Za-z]:\\/.test(filePath)) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }

  return { isValid: true }
}

/**
 * Handle external URL
 */
async function handleExternalUrl(url: string, fileType?: string): Promise<ParseResult> {
  try {
    logger.info('Fetching external URL:', url)

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

    // Extract filename from URL
    const urlPath = new URL(url).pathname
    const filename = urlPath.split('/').pop() || 'download'
    const extension = path.extname(filename).toLowerCase().substring(1)

    // Process the file based on its content type
    if (extension === 'pdf') {
      return await handlePdfBuffer(buffer, filename, fileType, url)
    }
    if (extension === 'csv') {
      return await handleCsvBuffer(buffer, filename, fileType, url)
    }
    if (isSupportedFileType(extension)) {
      return await handleGenericTextBuffer(buffer, filename, extension, fileType, url)
    }

    // For binary or unknown files
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
 * Handle file stored in cloud storage (S3 or Azure Blob)
 */
async function handleCloudFile(filePath: string, fileType?: string): Promise<ParseResult> {
  try {
    // Extract the cloud key from the path
    let cloudKey: string
    if (filePath.includes('/api/files/serve/s3/')) {
      cloudKey = decodeURIComponent(filePath.split('/api/files/serve/s3/')[1])
    } else if (filePath.includes('/api/files/serve/blob/')) {
      cloudKey = decodeURIComponent(filePath.split('/api/files/serve/blob/')[1])
    } else if (filePath.startsWith('/api/files/serve/')) {
      // Backwards-compatibility: path like "/api/files/serve/<key>"
      cloudKey = decodeURIComponent(filePath.substring('/api/files/serve/'.length))
    } else {
      // Assume raw key provided
      cloudKey = filePath
    }

    logger.info('Extracted cloud key:', cloudKey)

    // Download the file from cloud storage - this can throw for access errors
    const fileBuffer = await downloadFile(cloudKey)
    logger.info(`Downloaded file from cloud storage: ${cloudKey}, size: ${fileBuffer.length} bytes`)

    // Extract the filename from the cloud key
    const filename = cloudKey.split('/').pop() || cloudKey
    const extension = path.extname(filename).toLowerCase().substring(1)

    // Process the file based on its content type
    if (extension === 'pdf') {
      return await handlePdfBuffer(fileBuffer, filename, fileType, filePath)
    }
    if (extension === 'csv') {
      return await handleCsvBuffer(fileBuffer, filename, fileType, filePath)
    }
    if (isSupportedFileType(extension)) {
      // For other supported types that we have parsers for
      return await handleGenericTextBuffer(fileBuffer, filename, extension, fileType, filePath)
    }
    // For binary or unknown files
    return handleGenericBuffer(fileBuffer, filename, extension, fileType)
  } catch (error) {
    logger.error(`Error handling cloud file ${filePath}:`, error)

    // Check if this is a download/access error that should trigger a 500 response
    const errorMessage = (error as Error).message
    if (errorMessage.includes('Access denied') || errorMessage.includes('Forbidden')) {
      // For access errors, throw to trigger 500 response
      throw new Error(`Error accessing file from cloud storage: ${errorMessage}`)
    }

    // For other errors (parsing, processing), return success:false
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
async function handleLocalFile(filePath: string, fileType?: string): Promise<ParseResult> {
  try {
    // Extract filename from path
    const filename = filePath.split('/').pop() || filePath
    const fullPath = path.join(UPLOAD_DIR, filename)

    logger.info('Processing local file:', fullPath)

    // Check if file exists
    try {
      await fsPromises.access(fullPath)
    } catch {
      throw new Error(`File not found: ${filename}`)
    }

    // Parse the file directly
    const result = await parseFile(fullPath)

    // Get file stats for metadata
    const stats = await fsPromises.stat(fullPath)
    const fileBuffer = await readFile(fullPath)
    const hash = createHash('md5').update(fileBuffer).digest('hex')

    // Extract file extension for type detection
    const extension = path.extname(filename).toLowerCase().substring(1)

    return {
      success: true,
      content: result.content,
      filePath,
      metadata: {
        fileType: fileType || getMimeType(extension),
        size: stats.size,
        hash,
        processingTime: 0, // Will be set by caller
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
        processingTime: 0, // Will be set by caller
      },
    }
  } catch (error) {
    logger.error('Failed to parse PDF in memory:', error)

    // Create fallback message for PDF parsing failure
    const content = createPdfFailureMessage(
      0, // We can't determine page count without parsing
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
        processingTime: 0, // Will be set by caller
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

    // Use the parseBuffer function from our library
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
        processingTime: 0, // Will be set by caller
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
        processingTime: 0, // Will be set by caller
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

    // Try to use a specialized parser if available
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
            processingTime: 0, // Will be set by caller
          },
        }
      }
    } catch (parserError) {
      logger.warn('Specialized parser failed, falling back to generic parsing:', parserError)
    }

    // Fallback to generic text parsing
    const content = fileBuffer.toString('utf-8')

    return {
      success: true,
      content,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || getMimeType(extension),
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0, // Will be set by caller
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
        processingTime: 0, // Will be set by caller
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
      processingTime: 0, // Will be set by caller
    },
  }
}

/**
 * Parse a PDF buffer
 */
async function parseBufferAsPdf(buffer: Buffer) {
  try {
    // Import parsers dynamically to avoid initialization issues in tests
    // First try to use the main PDF parser
    try {
      const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')
      const parser = new PdfParser()
      logger.info('Using main PDF parser for buffer')

      if (parser.parseBuffer) {
        return await parser.parseBuffer(buffer)
      }
      throw new Error('PDF parser does not support buffer parsing')
    } catch (error) {
      // Fallback to raw PDF parser
      logger.warn('Main PDF parser failed, using raw parser for buffer:', error)
      const { RawPdfParser } = await import('@/lib/file-parsers/raw-pdf-parser')
      const rawParser = new RawPdfParser()

      return await rawParser.parseBuffer(buffer)
    }
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
  const formattedPath = path
    ? path.includes('/api/files/serve/s3/')
      ? `S3 path: ${decodeURIComponent(path.split('/api/files/serve/s3/')[1])}`
      : `Local path: ${path}`
    : 'Unknown path'

  return `PDF document - ${pageCount} page(s), ${prettySize(size)}
Path: ${formattedPath}

This file appears to be a PDF document that could not be fully processed as text.
Please use a PDF viewer for best results.`
}

/**
 * Create error message for PDF parsing failure
 */
function createPdfFailureMessage(
  pageCount: number,
  size: number,
  path: string,
  error: string
): string {
  const formattedPath = path.includes('/api/files/serve/s3/')
    ? `S3 path: ${decodeURIComponent(path.split('/api/files/serve/s3/')[1])}`
    : `Local path: ${path}`

  return `PDF document - Processing failed, ${prettySize(size)}
Path: ${formattedPath}
Error: ${error}

This file appears to be a PDF document that could not be processed.
Please use a PDF viewer for best results.`
}
