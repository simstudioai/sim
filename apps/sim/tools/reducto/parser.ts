import { createLogger } from '@sim/logger'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { ReductoParserInput, ReductoParserOutput } from '@/tools/reducto/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ReductoParserTool')

export const reductoParserTool: ToolConfig<ReductoParserInput, ReductoParserOutput> = {
  id: 'reducto_parser',
  name: 'Reducto PDF Parser',
  description: 'Parse PDF documents using Reducto OCR API',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'URL to a PDF document to be processed',
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

      if (
        params.fileUpload &&
        (!params.filePath || params.filePath === 'null' || params.filePath === '')
      ) {
        if (
          typeof params.fileUpload === 'object' &&
          params.fileUpload !== null &&
          (params.fileUpload.url || params.fileUpload.path)
        ) {
          let uploadedFilePath = (params.fileUpload.url || params.fileUpload.path) as string

          if (uploadedFilePath.startsWith('/')) {
            const baseUrl = getBaseUrl()
            if (!baseUrl) throw new Error('Failed to get base URL for file path conversion')
            uploadedFilePath = `${baseUrl}${uploadedFilePath}`
          }

          params.filePath = uploadedFilePath as string
          logger.info('Using uploaded file:', uploadedFilePath)
        } else {
          throw new Error('Invalid file upload: Upload data is missing or invalid')
        }
      }

      if (
        !params.filePath ||
        typeof params.filePath !== 'string' ||
        params.filePath.trim() === ''
      ) {
        throw new Error('Missing or invalid file path: Please provide a URL to a PDF document')
      }

      let filePathToValidate = params.filePath.trim()
      if (filePathToValidate.startsWith('/')) {
        const baseUrl = getBaseUrl()
        if (!baseUrl) throw new Error('Failed to get base URL for file path conversion')
        filePathToValidate = `${baseUrl}${filePathToValidate}`
      }

      let url
      try {
        url = new URL(filePathToValidate)

        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error(`Invalid protocol: ${url.protocol}. URL must use HTTP or HTTPS protocol`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Invalid URL format: ${errorMessage}. Please provide a valid HTTP or HTTPS URL to a PDF document.`
        )
      }

      const requestBody: Record<string, unknown> = {
        apiKey: params.apiKey,
        filePath: url.toString(),
      }

      if (params.fileUpload?.path?.startsWith('/api/files/serve/')) {
        requestBody.filePath = params.fileUpload.path
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
