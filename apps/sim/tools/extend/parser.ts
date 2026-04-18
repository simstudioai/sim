import { toError } from '@/lib/core/utils/helpers'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import type {
  ExtendParserInput,
  ExtendParserOutput,
  ExtendParserV2Input,
} from '@/tools/extend/types'
import type { ToolConfig } from '@/tools/types'

export const extendParserTool: ToolConfig<ExtendParserInput, ExtendParserOutput> = {
  id: 'extend_parser',
  name: 'Extend Document Parser',
  description: 'Parse and extract content from documents using Extend AI',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'URL to a document to be processed',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Document file to be processed',
    },
    fileUpload: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'File upload data from file-upload component',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target output format (markdown or spatial). Defaults to markdown.',
    },
    chunking: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Chunking strategy (page, document, or section). Defaults to page.',
    },
    engine: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Parsing engine (parse_performance or parse_light). Defaults to parse_performance.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Extend API key',
    },
  },

  request: {
    url: '/api/tools/extend/parse',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters: Parameters must be provided as an object')
      }

      if (!params.apiKey || typeof params.apiKey !== 'string' || params.apiKey.trim() === '') {
        throw new Error('Missing or invalid API key: A valid Extend API key is required')
      }

      const requestBody: Record<string, unknown> = {
        apiKey: params.apiKey,
      }

      const fileInput =
        params.file && typeof params.file === 'object' ? params.file : params.fileUpload
      const hasFileUpload = fileInput && typeof fileInput === 'object'
      const hasFilePath =
        typeof params.filePath === 'string' &&
        params.filePath !== 'null' &&
        params.filePath.trim() !== ''

      if (hasFilePath) {
        const filePathToValidate = params.filePath!.trim()

        if (filePathToValidate.startsWith('/')) {
          if (!isInternalFileUrl(filePathToValidate)) {
            throw new Error(
              'Invalid file path. Only uploaded files are supported for internal paths.'
            )
          }
          requestBody.filePath = filePathToValidate
        } else {
          let url
          try {
            url = new URL(filePathToValidate)

            if (!['http:', 'https:'].includes(url.protocol)) {
              throw new Error(
                `Invalid protocol: ${url.protocol}. URL must use HTTP or HTTPS protocol`
              )
            }
          } catch (error) {
            const errorMessage = toError(error).message
            throw new Error(
              `Invalid URL format: ${errorMessage}. Please provide a valid HTTP or HTTPS URL to a document.`
            )
          }

          requestBody.filePath = url.toString()
        }
      } else if (hasFileUpload) {
        requestBody.file = fileInput
      } else {
        throw new Error('Missing file input: Please provide a document URL or upload a file')
      }

      if (params.outputFormat && ['markdown', 'spatial'].includes(params.outputFormat)) {
        requestBody.outputFormat = params.outputFormat
      }

      if (params.chunking && ['page', 'document', 'section'].includes(params.chunking)) {
        requestBody.chunking = params.chunking
      }

      if (params.engine && ['parse_performance', 'parse_light'].includes(params.engine)) {
        requestBody.engine = params.engine
      }

      return requestBody
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format from Extend API')
    }

    const extendData = data.output ?? data

    return {
      success: true,
      output: {
        id: extendData.id ?? null,
        status: extendData.status ?? null,
        chunks: extendData.chunks ?? [],
        blocks: extendData.blocks ?? [],
        pageCount: extendData.pageCount ?? extendData.page_count ?? null,
        creditsUsed: extendData.creditsUsed ?? extendData.credits_used ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique identifier for the parser run' },
    status: { type: 'string', description: 'Processing status' },
    chunks: {
      type: 'json',
      description: 'Parsed document content chunks',
    },
    blocks: {
      type: 'json',
      description: 'Block-level document elements with type and content',
    },
    pageCount: {
      type: 'number',
      description: 'Number of pages processed',
      optional: true,
    },
    creditsUsed: {
      type: 'number',
      description: 'API credits consumed',
      optional: true,
    },
  },
}

export const extendParserV2Tool: ToolConfig<ExtendParserV2Input, ExtendParserOutput> = {
  ...extendParserTool,
  id: 'extend_parser_v2',
  name: 'Extend Document Parser',
  postProcess: undefined,
  directExecution: undefined,
  transformResponse: extendParserTool.transformResponse
    ? (response: Response, params?: ExtendParserV2Input) =>
        extendParserTool.transformResponse!(response, params as unknown as ExtendParserInput)
    : undefined,
  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'Document to be processed',
    },
    outputFormat: extendParserTool.params.outputFormat,
    chunking: extendParserTool.params.chunking,
    engine: extendParserTool.params.engine,
    apiKey: extendParserTool.params.apiKey,
  },
  request: {
    url: '/api/tools/extend/parse',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params: ExtendParserV2Input) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters: Parameters must be provided as an object')
      }

      if (!params.apiKey || typeof params.apiKey !== 'string' || params.apiKey.trim() === '') {
        throw new Error('Missing or invalid API key: A valid Extend API key is required')
      }

      if (!params.file || typeof params.file !== 'object') {
        throw new Error('Missing or invalid file: Please provide a file object')
      }

      const requestBody: Record<string, unknown> = {
        apiKey: params.apiKey,
        file: params.file,
      }

      if (params.outputFormat && ['markdown', 'spatial'].includes(params.outputFormat)) {
        requestBody.outputFormat = params.outputFormat
      }

      if (params.chunking && ['page', 'document', 'section'].includes(params.chunking)) {
        requestBody.chunking = params.chunking
      }

      if (params.engine && ['parse_performance', 'parse_light'].includes(params.engine)) {
        requestBody.engine = params.engine
      }

      return requestBody
    },
  },
}
