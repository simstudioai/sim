import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import fsPromises, { readFile, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import binaryExtensionsList from 'binary-extensions'
import { type NextRequest, NextResponse } from 'next/server'
import { isSupportedFileType, parseFile } from '@/lib/file-parsers'
import { createLogger } from '@/lib/logs/console-logger'
import { downloadFromS3 } from '@/lib/uploads/s3-client'
import { UPLOAD_DIR, USE_S3_STORAGE } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesParseAPI')

const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
const DOWNLOAD_TIMEOUT_MS = 30000 // 30 seconds

interface ParseSuccessResult {
  success: true
  output: {
    content: string
    fileType: string
    size: number
    name: string
    binary: boolean
    metadata?: Record<string, any>
  }
  filePath?: string
}

interface ParseErrorResult {
  success: false
  error: string
  filePath?: string
}

type ParseResult = ParseSuccessResult | ParseErrorResult

// MIME type mapping for various file extensions
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
  try {
    const requestData = await request.json()
    const { filePath, fileType } = requestData

    logger.info('File parse request received:', { filePath, fileType })

    if (!filePath) {
      return NextResponse.json({ error: 'No file path provided' }, { status: 400 })
    }

    // Handle both single file path and array of file paths
    const filePaths = Array.isArray(filePath) ? filePath : [filePath]

    // Parse each file
    const results = await Promise.all(
      filePaths.map(async (singleFilePath) => {
        try {
          return await parseFileSingle(singleFilePath, fileType)
        } catch (error) {
          logger.error(`Error parsing file ${singleFilePath}:`, error)
          return {
            success: false,
            error: (error as Error).message,
            filePath: singleFilePath,
          } as ParseErrorResult
        }
      })
    )

    // If it was a single file request, return a single result
    // Otherwise return an array of results
    if (!Array.isArray(filePath)) {
      // Single file was requested
      const result = results[0]
      return NextResponse.json(result)
    }

    // Multiple files were requested
    return NextResponse.json({
      success: true,
      results,
    })
  } catch (error) {
    logger.error('Error parsing file(s):', error)
    return NextResponse.json(
      { error: 'Failed to parse file(s)', message: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * Parse a single file and return its content
 */
async function parseFileSingle(filePath: string, fileType?: string): Promise<ParseResult> {
  logger.info('Parsing file:', filePath)

  // Check if this is an external URL
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return handleExternalUrl(filePath, fileType)
  }

  // Check if this is an S3 path
  const isS3Path = filePath.includes('/api/files/serve/s3/')

  // Use S3 handler if it's an S3 path or we're in S3 mode
  if (isS3Path || USE_S3_STORAGE) {
    return handleS3File(filePath, fileType)
  }

  // Use local handler for local files
  return handleLocalFile(filePath, fileType)
}

/**
 * Handle an external URL by downloading the file first
 */
async function handleExternalUrl(url: string, fileType?: string): Promise<ParseResult> {
  logger.info(`Handling external URL: ${url}`)

  try {
    // Create a unique filename for the temporary file
    const urlHash = createHash('md5').update(url).digest('hex')
    const urlObj = new URL(url)
    const originalFilename = urlObj.pathname.split('/').pop() || 'download'
    const tmpFilename = `${urlHash}-${originalFilename}`
    const tmpFilePath = path.join(tmpdir(), tmpFilename)

    // Download the file using native fetch
    logger.info(`Downloading file from URL to ${tmpFilePath}`)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'SimStudio/1.0',
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), // Add timeout
    })

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
    }

    // Check file size before downloading content
    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      const fileSize = Number.parseInt(contentLength, 10)
      if (fileSize > MAX_DOWNLOAD_SIZE_BYTES) {
        throw new Error(
          `File size (${prettySize(fileSize)}) exceeds the limit of ${prettySize(
            MAX_DOWNLOAD_SIZE_BYTES
          )}.`
        )
      }
    } else {
      logger.warn('Content-Length header missing, cannot verify file size before download.')
    }

    // Get the file buffer from response
    const arrayBuffer = await response.arrayBuffer()
    const fileBuffer = Buffer.from(arrayBuffer)

    // Write to temporary file
    await writeFile(tmpFilePath, fileBuffer)
    logger.info(`Downloaded ${fileBuffer.length} bytes to ${tmpFilePath}`)

    // Determine file extension and type
    const contentType = response.headers.get('content-type') || ''
    const extension =
      path.extname(originalFilename).toLowerCase().substring(1) ||
      (contentType ? contentType.split('/').pop() || 'unknown' : 'unknown')

    try {
      // Process based on file type
      let result: ParseResult

      if (extension === 'pdf') {
        result = await handlePdfBuffer(fileBuffer, originalFilename, fileType, url)
      } else if (extension === 'csv') {
        result = await handleCsvBuffer(fileBuffer, originalFilename, fileType, url)
      } else if (isSupportedFileType(extension)) {
        result = await handleGenericTextBuffer(
          fileBuffer,
          originalFilename,
          extension,
          fileType,
          url
        )
      } else {
        result = handleGenericBuffer(fileBuffer, originalFilename, extension, fileType)
      }

      // Clean up temporary file
      try {
        await unlink(tmpFilePath)
        logger.info(`Deleted temporary file: ${tmpFilePath}`)
      } catch (cleanupError) {
        logger.warn(`Failed to delete temporary file ${tmpFilePath}:`, cleanupError)
      }

      return result
    } catch (parseError) {
      logger.error(`Error parsing downloaded file: ${url}`, parseError)

      // Clean up temporary file on error
      try {
        await unlink(tmpFilePath)
      } catch (_cleanupError) {
        // Ignore cleanup errors on parse failure
      }

      throw parseError
    }
  } catch (error) {
    logger.error(`Error handling external URL ${url}:`, error)
    let errorMessage = `Failed to download or process file from URL: ${(error as Error).message}`
    if ((error as Error).name === 'TimeoutError') {
      errorMessage = `Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000} seconds.`
    }
    return {
      success: false,
      error: errorMessage,
      filePath: url,
    }
  }
}

/**
 * Handle file stored in S3
 */
async function handleS3File(filePath: string, fileType?: string): Promise<ParseResult> {
  try {
    // Extract the S3 key from the path
    const isS3Path = filePath.includes('/api/files/serve/s3/')
    const s3Key = isS3Path
      ? decodeURIComponent(filePath.split('/api/files/serve/s3/')[1])
      : filePath

    logger.info('Extracted S3 key:', s3Key)

    // Download the file from S3
    const fileBuffer = await downloadFromS3(s3Key)
    logger.info(`Downloaded file from S3: ${s3Key}, size: ${fileBuffer.length} bytes`)

    // Extract the filename from the S3 key
    const filename = s3Key.split('/').pop() || s3Key
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
    logger.error(`Error handling S3 file ${filePath}:`, error)
    return {
      success: false,
      error: `Error accessing file from S3: ${(error as Error).message}`,
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
      output: {
        content,
        fileType: fileType || 'application/pdf',
        size: fileBuffer.length,
        name: filename,
        binary: false,
        metadata: result.metadata || {},
      },
      filePath: originalPath,
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
      output: {
        content,
        fileType: fileType || 'application/pdf',
        size: fileBuffer.length,
        name: filename,
        binary: false,
      },
      filePath: originalPath,
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
    const { parseBuffer } = await import('../../../../lib/file-parsers')
    const result = await parseBuffer(fileBuffer, 'csv')

    return {
      success: true,
      output: {
        content: result.content,
        fileType: fileType || 'text/csv',
        size: fileBuffer.length,
        name: filename,
        binary: false,
        metadata: result.metadata || {},
      },
      filePath: originalPath,
    }
  } catch (error) {
    logger.error('Failed to parse CSV in memory:', error)
    return {
      success: false,
      error: `Failed to parse CSV: ${(error as Error).message}`,
      filePath: originalPath,
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
      const { parseBuffer, isSupportedFileType } = await import('../../../../lib/file-parsers')

      if (isSupportedFileType(extension)) {
        const result = await parseBuffer(fileBuffer, extension)

        return {
          success: true,
          output: {
            content: result.content,
            fileType: fileType || getMimeType(extension),
            size: fileBuffer.length,
            name: filename,
            binary: false,
            metadata: result.metadata || {},
          },
          filePath: originalPath,
        }
      }
    } catch (parserError) {
      logger.warn('Specialized parser failed, falling back to generic parsing:', parserError)
    }

    // Fallback to generic text parsing
    const content = fileBuffer.toString('utf-8')

    return {
      success: true,
      output: {
        content,
        fileType: fileType || getMimeType(extension),
        size: fileBuffer.length,
        name: filename,
        binary: false,
      },
      filePath: originalPath,
    }
  } catch (error) {
    logger.error('Failed to parse text file in memory:', error)
    return {
      success: false,
      error: `Failed to parse file: ${(error as Error).message}`,
      filePath: originalPath,
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
    output: {
      content,
      fileType: fileType || getMimeType(extension),
      size: fileBuffer.length,
      name: filename,
      binary: isBinary,
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
      const { PdfParser } = await import('../../../../lib/file-parsers/pdf-parser')
      const parser = new PdfParser()
      logger.info('Using main PDF parser for buffer')

      if (parser.parseBuffer) {
        return await parser.parseBuffer(buffer)
      }
      throw new Error('PDF parser does not support buffer parsing')
    } catch (error) {
      // Fallback to raw PDF parser
      logger.warn('Main PDF parser failed, using raw parser for buffer:', error)
      const { RawPdfParser } = await import('../../../../lib/file-parsers/raw-pdf-parser')
      const rawParser = new RawPdfParser()

      return await rawParser.parseBuffer(buffer)
    }
  } catch (error) {
    throw new Error(`PDF parsing failed: ${(error as Error).message}`)
  }
}

/**
 * Validate that a file path is safe and within allowed directories
 */
function validateAndResolvePath(inputPath: string): {
  isValid: boolean
  resolvedPath?: string
  error?: string
} {
  try {
    let targetPath = inputPath
    if (inputPath.startsWith('/api/files/serve/')) {
      const filename = inputPath.replace('/api/files/serve/', '')
      targetPath = path.join(UPLOAD_DIR, filename)
    }

    const resolvedPath = path.resolve(targetPath)
    const resolvedUploadDir = path.resolve(UPLOAD_DIR)

    if (
      !resolvedPath.startsWith(resolvedUploadDir + path.sep) &&
      resolvedPath !== resolvedUploadDir
    ) {
      return {
        isValid: false,
        error: `Access denied: Path outside allowed directory`,
      }
    }

    if (inputPath.includes('..') || inputPath.includes('~')) {
      return {
        isValid: false,
        error: `Access denied: Invalid path characters detected`,
      }
    }

    return {
      isValid: true,
      resolvedPath,
    }
  } catch (error) {
    return {
      isValid: false,
      error: `Path validation error: ${(error as Error).message}`,
    }
  }
}

/**
 * Handle a local file from the filesystem
 */
async function handleLocalFile(filePath: string, fileType?: string): Promise<ParseResult> {
  if (filePath.includes('/api/files/serve/s3/')) {
    logger.warn(`S3 path detected in handleLocalFile, redirecting to S3 handler: ${filePath}`)
    return handleS3File(filePath, fileType)
  }

  try {
    logger.info(`Handling local file: ${filePath}`)

    const pathValidation = validateAndResolvePath(filePath)
    if (!pathValidation.isValid) {
      logger.error(`Path validation failed: ${pathValidation.error}`, { filePath })
      return {
        success: false,
        error: pathValidation.error || 'Invalid file path',
        filePath,
      }
    }

    const localFilePath = pathValidation.resolvedPath!
    logger.info(`Validated and resolved path: ${localFilePath}`)

    try {
      await fsPromises.access(localFilePath, fsPromises.constants.R_OK)
    } catch (error) {
      logger.error(`File access error: ${localFilePath}`, error)
      return {
        success: false,
        error: `File not found or inaccessible: ${filePath}`,
        filePath,
      }
    }

    // Get file stats
    const stats = await fsPromises.stat(localFilePath)
    if (!stats.isFile()) {
      logger.error(`Not a file: ${localFilePath}`)
      return {
        success: false,
        error: `Not a file: ${filePath}`,
        filePath,
      }
    }

    // Extract the filename from the path
    const filename = path.basename(localFilePath)
    const extension = path.extname(filename).toLowerCase().substring(1)

    // Process the file based on its type
    const result = isSupportedFileType(extension)
      ? await processWithSpecializedParser(localFilePath, filename, extension, fileType, filePath)
      : await handleGenericFile(localFilePath, filename, extension, fileType)

    return result
  } catch (error) {
    logger.error(`Error handling local file ${filePath}:`, error)
    return {
      success: false,
      error: `Error processing file: ${(error as Error).message}`,
      filePath,
    }
  }
}

/**
 * Process a file with a specialized parser
 */
async function processWithSpecializedParser(
  filePath: string,
  filename: string,
  extension: string,
  fileType?: string,
  originalPath?: string
): Promise<ParseResult> {
  try {
    logger.info(`Parsing ${filename} with specialized parser for ${extension}`)
    const result = await parseFile(filePath)

    // Get file stats
    const fileBuffer = await readFile(filePath)
    const fileSize = fileBuffer.length

    // Handle PDF-specific validation
    if (
      extension === 'pdf' &&
      (result.content.includes('\u0000') ||
        result.content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]{10,}/g))
    ) {
      result.content = createPdfFallbackMessage(result.metadata?.pageCount, fileSize, originalPath)
    }

    return {
      success: true,
      output: {
        content: result.content,
        fileType: fileType || getMimeType(extension),
        size: fileSize,
        name: filename,
        binary: false,
        metadata: result.metadata || {},
      },
      filePath: originalPath || filePath,
    }
  } catch (error) {
    logger.error(`Specialized parser failed for ${extension} file:`, error)

    // Special handling for PDFs
    if (extension === 'pdf') {
      const fileBuffer = await readFile(filePath)
      const fileSize = fileBuffer.length

      // Get page count using a simple regex pattern
      let pageCount = 0
      const pdfContent = fileBuffer.toString('utf-8')
      const pageMatches = pdfContent.match(/\/Type\s*\/Page\b/gi)
      if (pageMatches) {
        pageCount = pageMatches.length
      }

      const content = createPdfFailureMessage(
        pageCount,
        fileSize,
        originalPath || filePath,
        (error as Error).message
      )

      return {
        success: true,
        output: {
          content,
          fileType: fileType || getMimeType(extension),
          size: fileSize,
          name: filename,
          binary: false,
        },
        filePath: originalPath || filePath,
      }
    }

    // For other file types, fall back to generic handling
    return handleGenericFile(filePath, filename, extension, fileType)
  }
}

/**
 * Handle generic file types with basic parsing
 */
async function handleGenericFile(
  filePath: string,
  filename: string,
  extension: string,
  fileType?: string
): Promise<ParseResult> {
  try {
    // Read the file
    const fileBuffer = await readFile(filePath)
    const fileSize = fileBuffer.length

    // Determine if file should be treated as binary
    const isBinary = binaryExtensionsList.includes(extension)

    // Parse content based on binary status
    let content: string
    if (isBinary) {
      content = `[Binary ${extension.toUpperCase()} file - ${fileSize} bytes]`
    } else {
      content = await parseTextFile(fileBuffer)
    }

    // Always return success: true for generic files (even unsupported ones)
    return {
      success: true,
      output: {
        content,
        fileType: fileType || getMimeType(extension),
        size: fileSize,
        name: filename,
        binary: isBinary,
      },
    }
  } catch (error) {
    logger.error('Error handling generic file:', error)
    return {
      success: false,
      error: `Failed to parse file: ${(error as Error).message}`,
      filePath,
    }
  }
}

/**
 * Parse a text file buffer to string
 */
async function parseTextFile(fileBuffer: Buffer): Promise<string> {
  try {
    return fileBuffer.toString('utf-8')
  } catch (error) {
    return `[Unable to parse file as text: ${(error as Error).message}]`
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
