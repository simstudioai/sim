import { createLogger } from '@/lib/logs/console/logger'
import type {
  FileParseResult,
  FileParserInput,
  FileParserOutput,
  FileParserOutputData,
} from '@/tools/file/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FileParserTool')

export const fileParserTool: ToolConfig<FileParserInput, FileParserOutput> = {
  id: 'file_parser',
  name: 'File Parser',
  description: 'Parse one or more uploaded files or files from URLs (text, PDF, CSV, images, etc.)',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Path to the file(s). Can be a single path, URL, or an array of paths.',
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
    body: (params: any) => {
      logger.info('Request parameters received by tool body:', params)

      if (!params) {
        logger.error('Tool body received no parameters')
        throw new Error('No parameters provided to tool body')
      }

      let determinedFilePath: string | string[] | null = null
      const determinedFileType: string | undefined = params.fileType

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
        const filePaths = params.file.map((file: any) => file.path)
        determinedFilePath = filePaths // Always send as array
      }
      // 3. Check for file upload (single object)
      else if (params.file?.path) {
        logger.info('Tool body processing single file object upload')
        determinedFilePath = params.file.path
      }
      // 4. Check for deprecated multiple files case (from older blocks?)
      else if (params.files && Array.isArray(params.files)) {
        logger.info('Tool body processing legacy files array:', params.files.length)
        if (params.files.length > 0) {
          determinedFilePath = params.files.map((file: any) => file.path)
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
      return {
        filePath: determinedFilePath,
        fileType: determinedFileType,
        workspaceId: params.workspaceId || params._context?.workspaceId,
      }
    },
  },

  transformResponse: async (response: Response): Promise<FileParserOutput> => {
    logger.info('Received response status:', response.status)

    const result = await response.json()
    logger.info('Response parsed successfully')

    // Handle multiple files response
    if (result.results) {
      logger.info('Processing multiple files response')

      // Extract individual file results
      const fileResults = result.results.map((fileResult: any) => {
        return fileResult.output || fileResult
      })

      // Combine all file contents with clear dividers
      const combinedContent = fileResults
        .map((file: FileParseResult, index: number) => {
          const divider = `\n${'='.repeat(80)}\n`

          return file.content + (index < fileResults.length - 1 ? divider : '')
        })
        .join('\n')

      // Create the base output
      const output: FileParserOutputData = {
        files: fileResults,
        combinedContent,
      }

      return {
        success: true,
        output,
      }
    }

    // Handle single file response
    logger.info('Successfully parsed file:', result.output?.name || 'unknown')

    // For a single file, create the output with just array format
    const output: FileParserOutputData = {
      files: [result.output || result],
      combinedContent: result.output?.content || result.content || '',
    }

    return {
      success: true,
      output,
    }
  },

  outputs: {
    files: { type: 'array', description: 'Array of parsed files' },
    combinedContent: { type: 'string', description: 'Combined content of all parsed files' },
  },
}
