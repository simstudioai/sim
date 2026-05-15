import { createLogger } from '@sim/logger'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import type {
  FileParseResult,
  FileParserInput,
  FileParserOutput,
  FileParserOutputData,
  FileParserV3Output,
  FileParserV3OutputData,
  FileUploadInput,
} from '@/tools/file/types'
import { transformTable } from '@/tools/shared/table'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FileParserTool')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object'

const isUserFile = (value: unknown): value is UserFile =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.url === 'string' &&
  typeof value.size === 'number' &&
  typeof value.type === 'string' &&
  typeof value.key === 'string'

const isFileParseResult = (value: unknown): value is FileParseResult =>
  isRecord(value) &&
  typeof value.content === 'string' &&
  typeof value.fileType === 'string' &&
  typeof value.size === 'number' &&
  typeof value.name === 'string' &&
  typeof value.binary === 'boolean'

const normalizeHeaders = (headers: FileParserInput['headers']): Record<string, string> => {
  const transformed = transformTable(headers ?? null)
  return Object.entries(transformed).reduce(
    (acc, [key, value]) => {
      const headerName = key.trim()
      if (headerName && value !== undefined && value !== null) {
        acc[headerName] = String(value)
      }
      return acc
    },
    {} as Record<string, string>
  )
}

const normalizeFileParseResult = (value: unknown): FileParseResult => {
  if (isRecord(value) && isFileParseResult(value.output)) {
    return value.output
  }

  if (isFileParseResult(value)) {
    return value
  }

  const record = isRecord(value) ? value : {}
  const file = isUserFile(record.file) ? record.file : undefined
  const metadata = isRecord(record.metadata) ? record.metadata : undefined
  const fallback: FileParseResult = {
    content: typeof record.content === 'string' ? record.content : '',
    fileType: typeof record.fileType === 'string' ? record.fileType : '',
    size: typeof record.size === 'number' ? record.size : 0,
    name: typeof record.name === 'string' ? record.name : 'unknown',
    binary: typeof record.binary === 'boolean' ? record.binary : false,
    ...(metadata && { metadata }),
    ...(file && { file }),
  }

  return Object.assign({}, record, fallback)
}

interface ToolBodyParams extends Partial<FileParserInput> {
  files?: FileUploadInput[]
  _context?: {
    workspaceId?: string
    workflowId?: string
    executionId?: string
  }
}

const parseFileParserResponse = async (response: Response): Promise<FileParserOutput> => {
  logger.info('Received response status:', response.status)

  const result: unknown = await response.json()
  logger.info('Response parsed successfully')

  // Handle multiple files response
  if (isRecord(result) && Array.isArray(result.results)) {
    logger.info('Processing multiple files response')

    // Extract individual file results
    const fileResults: FileParseResult[] = result.results.map((fileResult) =>
      normalizeFileParseResult(fileResult)
    )

    // Collect UserFile objects from results
    const processedFiles: UserFile[] = fileResults
      .filter((file): file is FileParseResult & { file: UserFile } => Boolean(file.file))
      .map((file) => file.file)

    // Combine all file contents with clear dividers
    const combinedContent = fileResults
      .map((file, index) => {
        const divider = `\n${'='.repeat(80)}\n`

        return file.content + (index < fileResults.length - 1 ? divider : '')
      })
      .join('\n')

    // Create the base output
    const output: FileParserOutputData = {
      files: fileResults,
      combinedContent,
      ...(processedFiles.length > 0 && { processedFiles }),
    }

    return {
      success: true,
      output,
    }
  }

  // Handle single file response
  const fileOutput = normalizeFileParseResult(result)

  logger.info('Successfully parsed file:', fileOutput.name || 'unknown')

  // For a single file, create the output with just array format
  const output: FileParserOutputData = {
    files: [fileOutput],
    combinedContent:
      fileOutput.content ||
      (isRecord(result) && typeof result.content === 'string' ? result.content : ''),
    ...(fileOutput.file && { processedFiles: [fileOutput.file] }),
  }

  return {
    success: true,
    output,
  }
}

export const fileParserTool: ToolConfig<FileParserInput, FileParserOutput> = {
  id: 'file_parser',
  name: 'File Parser',
  description: 'Parse one or more uploaded files or files from URLs (text, PDF, CSV, images, etc.)',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Path to the file(s). Can be a single path, URL, or an array of paths.',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Uploaded file(s) to parse',
    },
    fileType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Type of file to parse (auto-detected if not specified)',
    },
  },

  request: {
    url: '/api/files/parse',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: ToolBodyParams) => {
      logger.info('Request parameters received by tool body:', params)

      if (!params) {
        logger.error('Tool body received no parameters')
        throw new Error('No parameters provided to tool body')
      }

      let determinedFilePath: string | string[] | null = null
      const determinedFileType: string | undefined = params.fileType

      const resolveFilePath = (fileInput: unknown): string | null => {
        if (!isRecord(fileInput)) return null

        if (typeof fileInput.path === 'string') {
          return fileInput.path
        }

        if (typeof fileInput.url === 'string') {
          return fileInput.url
        }

        if (typeof fileInput.key === 'string') {
          const key = fileInput.key
          const context =
            typeof fileInput.context === 'string' ? fileInput.context : inferContextFromKey(key)
          return `/api/files/serve/${encodeURIComponent(key)}?context=${context}`
        }

        return null
      }

      // Determine the file path(s) based on input parameters.
      // Precedence: direct filePath > file array > single file object > legacy files array
      // 1. Check for direct filePath (URL or single path from upload)
      if (params.filePath) {
        logger.info('Tool body found direct filePath:', params.filePath)
        determinedFilePath = params.filePath
      }
      // 2. Check for file upload (array)
      else if (params.file && Array.isArray(params.file) && params.file.length > 0) {
        logger.info('Tool body processing file array upload')
        const filePaths = params.file
          .map((file) => resolveFilePath(file))
          .filter(Boolean) as string[]
        if (filePaths.length !== params.file.length) {
          throw new Error('Invalid file input: One or more files are missing path or URL')
        }
        determinedFilePath = filePaths
      }
      // 3. Check for file upload (single object)
      else if (params.file && !Array.isArray(params.file)) {
        logger.info('Tool body processing single file object upload')
        const resolvedPath = resolveFilePath(params.file)
        if (!resolvedPath) {
          throw new Error('Invalid file input: Missing path or URL')
        }
        determinedFilePath = resolvedPath
      }
      // 4. Check for deprecated multiple files case (from older blocks?)
      else if (params.files && Array.isArray(params.files)) {
        logger.info('Tool body processing legacy files array:', params.files.length)
        if (params.files.length > 0) {
          const filePaths = params.files
            .map((file) => resolveFilePath(file))
            .filter(Boolean) as string[]
          if (filePaths.length !== params.files.length) {
            throw new Error('Invalid file input: One or more files are missing path or URL')
          }
          determinedFilePath = filePaths
        } else {
          logger.warn('Legacy files array provided but is empty')
        }
      }

      // Final check if filePath was determined
      if (!determinedFilePath) {
        logger.error('Tool body could not determine filePath from parameters:', params)
        throw new Error('Missing required parameter: filePath')
      }

      logger.info('Tool body determined filePath:', determinedFilePath)
      const headers = normalizeHeaders(params.headers)
      return {
        filePath: determinedFilePath,
        fileType: determinedFileType,
        ...(Object.keys(headers).length > 0 && { headers }),
        workspaceId: params.workspaceId || params._context?.workspaceId,
        workflowId: params._context?.workflowId,
        executionId: params._context?.executionId,
      }
    },
  },

  transformResponse: parseFileParserResponse,

  outputs: {
    files: { type: 'array', description: 'Array of parsed files with content and metadata' },
    combinedContent: { type: 'string', description: 'Combined content of all parsed files' },
    processedFiles: { type: 'file[]', description: 'Array of UserFile objects for downstream use' },
  },
}

export const fileParserV2Tool: ToolConfig<FileParserInput, FileParserOutput> = {
  id: 'file_parser_v2',
  name: 'File Parser',
  description: 'Parse one or more uploaded files or files from URLs (text, PDF, CSV, images, etc.)',
  version: '2.0.0',

  params: fileParserTool.params,
  request: fileParserTool.request,
  transformResponse: parseFileParserResponse,

  outputs: {
    files: {
      type: 'array',
      description: 'Array of parsed files with content, metadata, and file properties',
    },
    combinedContent: {
      type: 'string',
      description: 'All file contents merged into a single text string',
    },
  },
}

const parseFileParserV3Response = async (response: Response): Promise<FileParserV3Output> => {
  const parsed = await parseFileParserResponse(response)
  const output = parsed.output as FileParserOutputData
  const files =
    Array.isArray(output.processedFiles) && output.processedFiles.length > 0
      ? output.processedFiles
      : []

  const cleanedOutput: FileParserV3OutputData = {
    files,
    combinedContent: output.combinedContent,
  }

  return {
    success: true,
    output: cleanedOutput,
  }
}

export const fileParserV3Tool: ToolConfig<FileParserInput, FileParserV3Output> = {
  id: 'file_parser_v3',
  name: 'File Parser',
  description: 'Parse one or more uploaded files or files from URLs (text, PDF, CSV, images, etc.)',
  version: '3.0.0',
  params: fileParserTool.params,
  request: fileParserTool.request,
  transformResponse: parseFileParserV3Response,
  outputs: {
    files: { type: 'file[]', description: 'Parsed files as UserFile objects' },
    combinedContent: { type: 'string', description: 'Combined content of all parsed files' },
  },
}

export const fileFetchTool: ToolConfig<FileParserInput, FileParserV3Output> = {
  id: 'file_fetch',
  name: 'File Fetch',
  description: 'Fetch and parse a file from a URL with optional custom headers.',
  version: '1.0.0',
  params: {
    ...fileParserTool.params,
    headers: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTP headers to include when fetching URL-based files.',
    },
  },
  request: fileParserTool.request,
  transformResponse: parseFileParserV3Response,
  outputs: {
    files: { type: 'file[]', description: 'Fetched files as UserFile objects' },
    combinedContent: { type: 'string', description: 'Combined content of all fetched files' },
  },
}
