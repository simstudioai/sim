import { ToolConfig, ToolResponse } from '../types'

export interface FileParserInput {
  filePath: string | string[]
  fileType?: string
}

export interface FileParseResult {
  content: string
  fileType: string
  size: number
  name: string
  binary: boolean
  metadata?: Record<string, any>
}

export interface FileParserOutputData {
  files: FileParseResult[]
  combinedContent: string
  [key: string]: any
}

export interface FileParserOutput extends ToolResponse {
  output: FileParserOutputData
}

export const fileParserTool: ToolConfig<FileParserInput, FileParserOutput> = {
  id: 'file_parser',
  name: 'File Parser',
  description: 'Parse one or more uploaded files (text, PDF, CSV, images, etc.)',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: true,
      description: 'Path to the uploaded file(s). Can be a single path or an array of paths.',
    },
    fileType: {
      type: 'string',
      required: false,
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
      console.log('[fileParserTool] Request parameters:', params)

      // Check for valid input
      if (!params) {
        console.error('[fileParserTool] No parameters provided')
        throw new Error('No parameters provided')
      }

      // Handle various input formats
      let filePath = null

      // Handle multiple files case from block output
      if (params.files && Array.isArray(params.files)) {
        console.log('[fileParserTool] Processing multiple files:', params.files.length)
        filePath = params.files.map((file: any) => file.path)
      }
      // Handle the case where params is an object with file property
      else if (params.file) {
        if (Array.isArray(params.file)) {
          console.log(
            '[fileParserTool] Processing multiple files from file array:',
            params.file.length
          )
          filePath = params.file.map((file: any) => file.path)
        } else if (params.file.path) {
          console.log('[fileParserTool] Extracted file path from file object:', params.file.path)
          filePath = params.file.path
        }
      }
      // Handle direct filePath parameter
      else if (params.filePath) {
        console.log('[fileParserTool] Using direct filePath parameter:', params.filePath)
        filePath = params.filePath
      }

      if (!filePath) {
        console.error('[fileParserTool] Missing required parameter: filePath')
        throw new Error('Missing required parameter: filePath')
      }

      return {
        filePath,
        fileType: params.fileType,
      }
    },
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<FileParserOutput> => {
    console.log('[fileParserTool] Received response status:', response.status)

    try {
      const result = await response.json()
      console.log('[fileParserTool] Response parsed successfully')

      if (!response.ok) {
        const errorMsg = result.error || 'File parsing failed'
        console.error('[fileParserTool] Error in response:', errorMsg)
        throw new Error(errorMsg)
      }

      // Handle multiple files response
      if (result.results) {
        console.log('[fileParserTool] Processing multiple files response')

        // Extract individual file results
        const fileResults = result.results.map((fileResult: any) => {
          if (!fileResult.success) {
            console.warn(
              `[fileParserTool] Error parsing file ${fileResult.filePath}: ${fileResult.error}`
            )
            return {
              content: `Error parsing file: ${fileResult.error || 'Unknown error'}`,
              fileType: 'text/plain',
              size: 0,
              name: fileResult.filePath.split('/').pop() || 'unknown',
              binary: false,
            }
          }

          return fileResult.output
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

        // Add named properties for each file for dropdown access
        fileResults.forEach((file: FileParseResult, index: number) => {
          output[`file${index + 1}`] = file
        })

        return {
          success: true,
          output,
        }
      }

      // Handle single file response
      if (result.success) {
        console.log('[fileParserTool] Successfully parsed file:', result.output.name)

        // For a single file, create the output with both array and named property
        const output: FileParserOutputData = {
          files: [result.output],
          combinedContent: result.output.content,
          file1: result.output,
        }

        return {
          success: true,
          output,
        }
      }

      // Handle error response
      throw new Error(result.error || 'File parsing failed')
    } catch (error) {
      console.error('[fileParserTool] Error processing response:', error)
      throw error
    }
  },

  transformError: (error: any) => {
    console.error('[fileParserTool] Error occurred:', error)
    return error.message || 'File parsing failed'
  },
}
