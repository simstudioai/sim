import { ToolConfig, ToolResponse } from '../types'

export interface FileParserInput {
  filePath: string
  fileType?: string 
}

export interface FileParserOutput extends ToolResponse {
  output: {
    content: string
    fileType: string
    size: number
    name: string
    binary: boolean
  }
}

export const fileParserTool: ToolConfig<FileParserInput, FileParserOutput> = {
  id: 'file_parser',
  name: 'File Parser',
  description: 'Parse uploaded files (text, PDF, CSV, images, etc.)',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: true,
      description: 'Path to the uploaded file',
    },
    fileType: {
      type: 'string',
      required: false,
      description: 'Type of file to parse (auto-detected if not specified)',
    },
  },

  request: {
    url: '/api/file/parse',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: FileParserInput) => {
      return {
        filePath: params.filePath,
        fileType: params.fileType,
      }
    },
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<FileParserOutput> => {
    const result = await response.json()

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'File parsing failed')
    }

    return {
      success: true,
      output: {
        content: result.output.content,
        fileType: result.output.fileType,
        size: result.output.size,
        name: result.output.name,
        binary: result.output.binary || false,
      },
    }
  },

  transformError: (error: any) => {
    return error.message || 'File parsing failed'
  },
} 