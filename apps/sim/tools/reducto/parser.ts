import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import type {
  ReductoParserInput,
  ReductoParserOutput,
  ReductoParserV2Input,
} from '@/tools/reducto/types'
import type { ToolConfig } from '@/tools/types'

export const reductoParserTool: ToolConfig<ReductoParserInput, ReductoParserOutput> = {
  id: 'reducto_parser',
  name: 'Reducto PDF Parser',
  description: 'Parse PDF documents using Reducto OCR API',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'URL to a PDF document to be processed',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'hidden',
      description: 'Document file to be processed',
    },
    fileUpload: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'File upload data from file-upload component',
    },
    pages: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Specific pages to process (1-indexed page numbers)',
    },
    tableOutputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Table output format (html or markdown). Defaults to markdown.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Reducto API key (REDUCTO_API_KEY)',
    },
  },

  request: {
    url: '/api/tools/reducto/parse',
    method: 'POST',
    headers: (params) => {
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
    body: (params) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters: Parameters must be provided as an object')
      }

      if (!params.apiKey || typeof params.apiKey !== 'string' || params.apiKey.trim() === '') {
        throw new Error('Missing or invalid API key: A valid Reducto API key is required')
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
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(
              `Invalid URL format: ${errorMessage}. Please provide a valid HTTP or HTTPS URL to a PDF document.`
            )
          }

          requestBody.filePath = url.toString()
        }
      } else if (hasFileUpload) {
        requestBody.file = fileInput
      } else {
        throw new Error('Missing file input: Please provide a PDF URL or upload a file')
      }

      if (params.tableOutputFormat && ['html', 'md'].includes(params.tableOutputFormat)) {
        requestBody.tableOutputFormat = params.tableOutputFormat
      }

      if (params.pages !== undefined && params.pages !== null) {
        if (Array.isArray(params.pages) && params.pages.length > 0) {
          const validPages = params.pages.filter(
            (page) => typeof page === 'number' && Number.isInteger(page) && page >= 0
          )

          if (validPages.length > 0) {
            requestBody.pages = validPages
          }
        }
      }

      return requestBody
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format from Reducto API')
    }

    const reductoData = data.output ?? data

    return {
      success: true,
      output: {
        job_id: reductoData.job_id,
        duration: reductoData.duration,
        usage: reductoData.usage,
        result: reductoData.result,
        pdf_url: reductoData.pdf_url ?? null,
        studio_link: reductoData.studio_link ?? null,
      },
    }
  },

  outputs: {
    job_id: { type: 'string', description: 'Unique identifier for the processing job' },
    duration: { type: 'number', description: 'Processing time in seconds' },
    usage: {
      type: 'json',
      description: 'Resource consumption data',
    },
    result: {
      type: 'json',
      description: 'Parsed document content with chunks and blocks',
    },
    pdf_url: {
      type: 'string',
      description: 'Storage URL of converted PDF',
      optional: true,
    },
    studio_link: {
      type: 'string',
      description: 'Link to Reducto studio interface',
      optional: true,
    },
  },
}

export const reductoParserV2Tool: ToolConfig<ReductoParserV2Input, ReductoParserOutput> = {
  ...reductoParserTool,
  id: 'reducto_parser_v2',
  name: 'Reducto PDF Parser',
  postProcess: undefined,
  directExecution: undefined,
  transformResponse: reductoParserTool.transformResponse
    ? (response: Response, params?: ReductoParserV2Input) =>
        reductoParserTool.transformResponse!(response, params as unknown as ReductoParserInput)
    : undefined,
  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'hidden',
      description: 'PDF document to be processed',
    },
    pages: reductoParserTool.params.pages,
    tableOutputFormat: reductoParserTool.params.tableOutputFormat,
    apiKey: reductoParserTool.params.apiKey,
  },
  request: {
    url: '/api/tools/reducto/parse',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params: ReductoParserV2Input) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters: Parameters must be provided as an object')
      }

      if (!params.apiKey || typeof params.apiKey !== 'string' || params.apiKey.trim() === '') {
        throw new Error('Missing or invalid API key: A valid Reducto API key is required')
      }

      if (!params.file || typeof params.file !== 'object') {
        throw new Error('Missing or invalid file: Please provide a file object')
      }

      const requestBody: Record<string, unknown> = {
        apiKey: params.apiKey,
        file: params.file,
      }

      if (params.tableOutputFormat && ['html', 'md'].includes(params.tableOutputFormat)) {
        requestBody.tableOutputFormat = params.tableOutputFormat
      }

      if (params.pages !== undefined && params.pages !== null) {
        if (Array.isArray(params.pages) && params.pages.length > 0) {
          const validPages = params.pages.filter(
            (page) => typeof page === 'number' && Number.isInteger(page) && page >= 0
          )

          if (validPages.length > 0) {
            requestBody.pages = validPages
          }
        }
      }

      return requestBody
    },
  },
}
