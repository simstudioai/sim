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
    metadata?: Record<string, any>
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
    url: '/api/files/parse',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: any) => {
      console.log('[fileParserTool] Request parameters:', params);

      // Handle the case where params is an object with file property (from the block)
      if (params && params.file && params.file.path) {
        console.log('[fileParserTool] Extracted file path from file object:', params.file.path);
        return {
          filePath: params.file.path,
          fileType: params.fileType === 'auto' ? undefined : params.fileType
        };
      }
      
      // Handle direct filePath parameter
      if (params && params.filePath) {
        console.log('[fileParserTool] Using direct filePath parameter:', params.filePath);
        return {
          filePath: params.filePath,
          fileType: params.fileType
        };
      }

      console.error('[fileParserTool] Missing required parameter: filePath');
      throw new Error('Missing required parameter: filePath');
    },
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<FileParserOutput> => {
    console.log('[fileParserTool] Received response status:', response.status);
    
    try {
      const result = await response.json()
      console.log('[fileParserTool] Response parsed successfully');

      if (!response.ok || !result.success) {
        const errorMsg = result.error || 'File parsing failed';
        console.error('[fileParserTool] Error in response:', errorMsg);
        throw new Error(errorMsg);
      }

      console.log('[fileParserTool] Successfully parsed file:', result.output.name);
      
      return {
        success: true,
        output: {
          content: result.output.content,
          fileType: result.output.fileType,
          size: result.output.size,
          name: result.output.name,
          binary: result.output.binary || false,
          metadata: result.output.metadata
        },
      }
    } catch (error) {
      console.error('[fileParserTool] Error processing response:', error);
      throw error;
    }
  },

  transformError: (error: any) => {
    console.error('[fileParserTool] Error occurred:', error);
    return error.message || 'File parsing failed'
  },
} 