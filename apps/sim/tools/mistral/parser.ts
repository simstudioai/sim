import { createLogger } from '@sim/logger'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import type {
  MistralParserInput,
  MistralParserOutput,
  MistralParserV2Input,
  MistralParserV2Output,
} from '@/tools/mistral/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MistralParserTool')

export const mistralParserTool: ToolConfig<MistralParserInput, MistralParserOutput> = {
  id: 'mistral_parser',
  name: 'Mistral PDF Parser',
  description: 'Parse PDF documents using Mistral OCR API',
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
    resultType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of parsed result (markdown, text, or json). Defaults to markdown.',
    },
    includeImageBase64: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Include base64-encoded images in the response',
    },
    pages: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Specific pages to process (array of page numbers, starting from 0)',
    },
    // Note: The following image-related parameters are still supported by the parser
    // but are disabled in the UI. They can be re-enabled if needed.
    imageLimit: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Maximum number of images to extract from the PDF',
    },
    imageMinSize: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Minimum height and width of images to extract from the PDF',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mistral API key (MISTRAL_API_KEY)',
    },
  },

  request: {
    url: '/api/tools/mistral/parse',
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
        throw new Error('Missing or invalid API key: A valid Mistral API key is required')
      }

      const fileInput =
        params.file && typeof params.file === 'object' ? params.file : params.fileUpload
      const hasFileUpload = fileInput && typeof fileInput === 'object'
      const hasFilePath =
        typeof params.filePath === 'string' &&
        params.filePath !== 'null' &&
        params.filePath.trim() !== ''

      const requestBody: Record<string, unknown> = {
        apiKey: params.apiKey,
      }

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
              `Invalid URL format: ${errorMessage}. Please provide a valid HTTP or HTTPS URL to a PDF document (e.g., https://example.com/document.pdf)`
            )
          }

          requestBody.filePath = url.toString()
        }
      } else if (hasFileUpload) {
        requestBody.file = fileInput
      } else {
        throw new Error('Missing file input: Please provide a PDF URL or upload a file')
      }

      if (params.includeImageBase64 !== undefined) {
        requestBody.includeImageBase64 = params.includeImageBase64
      }

      if (Array.isArray(params.pages) && params.pages.length > 0) {
        const validPages = params.pages.filter(
          (page) => typeof page === 'number' && Number.isInteger(page) && page >= 0
        )
        if (validPages.length > 0) {
          requestBody.pages = validPages
        }
      }

      if (typeof params.resultType === 'string' && params.resultType.trim() !== '') {
        requestBody.resultType = params.resultType
      }

      if (params.imageLimit !== undefined && params.imageLimit !== null) {
        const imageLimit = Number(params.imageLimit)
        if (!Number.isNaN(imageLimit) && imageLimit >= 0) {
          requestBody.imageLimit = imageLimit
        }
      }

      if (params.imageMinSize !== undefined && params.imageMinSize !== null) {
        const imageMinSize = Number(params.imageMinSize)
        if (!Number.isNaN(imageMinSize) && imageMinSize >= 0) {
          requestBody.imageMinSize = imageMinSize
        }
      }

      return requestBody
    },
  },

  transformResponse: async (response, params?) => {
    try {
      // Parse response data with proper error handling
      let ocrResult
      try {
        ocrResult = await response.json()
      } catch (jsonError) {
        throw new Error(
          `Failed to parse Mistral OCR response: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`
        )
      }

      if (!ocrResult || typeof ocrResult !== 'object') {
        throw new Error('Invalid response format from Mistral OCR API')
      }

      const mistralData =
        ocrResult.output && typeof ocrResult.output === 'object' && !ocrResult.pages
          ? ocrResult.output
          : ocrResult

      let resultType: 'markdown' | 'text' | 'json' = 'markdown'
      let sourceUrl = ''
      let isFileUpload = false

      if (params && typeof params === 'object') {
        if (params.filePath && typeof params.filePath === 'string') {
          sourceUrl = params.filePath.trim()
        }

        isFileUpload = !!params.fileUpload

        if (params.resultType && ['markdown', 'text', 'json'].includes(params.resultType)) {
          resultType = params.resultType as 'markdown' | 'text' | 'json'
        }
      } else if (
        mistralData.document &&
        typeof mistralData.document === 'object' &&
        mistralData.document.document_url &&
        typeof mistralData.document.document_url === 'string'
      ) {
        sourceUrl = mistralData.document.document_url
      }

      let content = ''
      const pageCount =
        mistralData.pages && Array.isArray(mistralData.pages) ? mistralData.pages.length : 0

      if (pageCount > 0) {
        content = mistralData.pages
          .map((page: any) => (page && typeof page.markdown === 'string' ? page.markdown : ''))
          .filter(Boolean)
          .join('\n\n')
      } else {
        logger.warn('No pages found in OCR result, returning raw response')
        content = JSON.stringify(mistralData, null, 2)
      }

      if (resultType === 'text') {
        content = content
          .replace(/##*\s/g, '') // Remove markdown headers
          .replace(/\*\*/g, '') // Remove bold markers
          .replace(/\*/g, '') // Remove italic markers
          .replace(/\n{3,}/g, '\n\n') // Normalize newlines
      } else if (resultType === 'json') {
        content = JSON.stringify(mistralData, null, 2)
      }

      let fileName = 'document.pdf'
      let fileType = 'pdf'

      if (sourceUrl) {
        try {
          const url = new URL(sourceUrl)
          const pathSegments = url.pathname.split('/')
          const lastSegment = pathSegments[pathSegments.length - 1]

          if (lastSegment && lastSegment.length > 0) {
            fileName = lastSegment
            const fileExtParts = fileName.split('.')
            if (fileExtParts.length > 1) {
              fileType = fileExtParts[fileExtParts.length - 1].toLowerCase()
            }
          }
        } catch (urlError) {
          logger.warn('Failed to parse document URL:', urlError)
        }
      }

      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(2, 10)
      const jobId = `mistral-ocr-${timestamp}-${randomId}`

      const usageInfo =
        mistralData.usage_info && typeof mistralData.usage_info === 'object'
          ? {
              pagesProcessed:
                typeof mistralData.usage_info.pages_processed === 'number'
                  ? mistralData.usage_info.pages_processed
                  : Number(mistralData.usage_info.pages_processed),
              docSizeBytes:
                mistralData.usage_info.doc_size_bytes == null
                  ? null
                  : typeof mistralData.usage_info.doc_size_bytes === 'number'
                    ? mistralData.usage_info.doc_size_bytes
                    : Number(mistralData.usage_info.doc_size_bytes),
            }
          : undefined

      const metadata: any = {
        jobId,
        fileType,
        fileName,
        source: 'url',
        pageCount,
        usageInfo,
        model: typeof mistralData.model === 'string' ? mistralData.model : 'mistral-ocr-latest',
        resultType,
        processedAt: new Date().toISOString(),
      }

      if (
        !isFileUpload &&
        sourceUrl &&
        !sourceUrl.includes('/api/files/serve/') &&
        !sourceUrl.includes('s3.amazonaws.com')
      ) {
        metadata.sourceUrl = sourceUrl
      }

      const parserResponse: MistralParserOutput = {
        success: true,
        output: {
          content,
          metadata,
        },
      }

      return parserResponse
    } catch (error) {
      logger.error('Error processing OCR result:', error)
      throw error
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the PDF was parsed successfully' },
    content: {
      type: 'string',
      description: 'Extracted content in the requested format (markdown, text, or JSON)',
    },
    metadata: {
      type: 'object',
      description: 'Processing metadata including jobId, fileType, pageCount, and usage info',
      properties: {
        jobId: { type: 'string', description: 'Unique job identifier' },
        fileType: { type: 'string', description: 'File type (e.g., pdf)' },
        fileName: { type: 'string', description: 'Original file name' },
        source: { type: 'string', description: 'Source type (url)' },
        pageCount: { type: 'number', description: 'Number of pages processed' },
        model: { type: 'string', description: 'Mistral model used' },
        resultType: { type: 'string', description: 'Output format (markdown, text, json)' },
        processedAt: { type: 'string', description: 'Processing timestamp' },
        sourceUrl: { type: 'string', description: 'Source URL if applicable', optional: true },
        usageInfo: {
          type: 'object',
          description: 'Usage statistics from OCR processing',
          optional: true,
        },
      },
    },
  },
}

export const mistralParserV2Tool: ToolConfig<MistralParserInput, MistralParserV2Output> = {
  id: 'mistral_parser_v2',
  name: 'Mistral PDF Parser',
  description: 'Parse PDF documents using Mistral OCR API',
  version: '2.0.0',

  params: mistralParserTool.params,
  request: mistralParserTool.request,

  transformResponse: async (response: Response) => {
    let ocrResult
    try {
      ocrResult = await response.json()
    } catch (jsonError) {
      throw new Error(
        `Failed to parse Mistral OCR response: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`
      )
    }

    if (!ocrResult || typeof ocrResult !== 'object') {
      throw new Error('Invalid response format from Mistral OCR API')
    }

    // Extract the actual Mistral data (may be nested in output from our API route)
    const mistralData =
      ocrResult.output && typeof ocrResult.output === 'object' && !ocrResult.pages
        ? ocrResult.output
        : ocrResult

    // Return raw Mistral API structure - no transformation
    return {
      success: true,
      output: {
        pages: mistralData.pages ?? [],
        model: mistralData.model ?? 'mistral-ocr-latest',
        usage_info: mistralData.usage_info ?? { pages_processed: 0, doc_size_bytes: null },
        document_annotation: mistralData.document_annotation ?? null,
      },
    }
  },

  outputs: {
    pages: {
      type: 'array',
      description: 'Array of page objects from Mistral OCR',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Page index (zero-based)' },
          markdown: { type: 'string', description: 'Extracted markdown content' },
          images: {
            type: 'array',
            description: 'Images extracted from this page with bounding boxes',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Image identifier (e.g., img-0.jpeg)' },
                top_left_x: { type: 'number', description: 'Top-left X coordinate in pixels' },
                top_left_y: { type: 'number', description: 'Top-left Y coordinate in pixels' },
                bottom_right_x: {
                  type: 'number',
                  description: 'Bottom-right X coordinate in pixels',
                },
                bottom_right_y: {
                  type: 'number',
                  description: 'Bottom-right Y coordinate in pixels',
                },
                image_base64: {
                  type: 'string',
                  description: 'Base64-encoded image data (when include_image_base64=true)',
                  optional: true,
                },
              },
            },
          },
          dimensions: {
            type: 'object',
            description: 'Page dimensions',
            properties: {
              dpi: { type: 'number', description: 'Dots per inch' },
              height: { type: 'number', description: 'Page height in pixels' },
              width: { type: 'number', description: 'Page width in pixels' },
            },
          },
          tables: {
            type: 'array',
            description:
              'Extracted tables as HTML/markdown (when table_format is set). Referenced via placeholders like [tbl-0.html]',
          },
          hyperlinks: {
            type: 'array',
            description:
              'Array of URL strings detected in the page (e.g., ["https://...", "mailto:..."])',
            items: {
              type: 'string',
              description: 'URL or mailto link',
            },
          },
          header: {
            type: 'string',
            description: 'Page header content (when extract_header=true)',
            optional: true,
          },
          footer: {
            type: 'string',
            description: 'Page footer content (when extract_footer=true)',
            optional: true,
          },
        },
      },
    },
    model: {
      type: 'string',
      description: 'Mistral OCR model identifier (e.g., mistral-ocr-latest)',
    },
    usage_info: {
      type: 'object',
      description: 'Usage and processing statistics',
      properties: {
        pages_processed: { type: 'number', description: 'Total number of pages processed' },
        doc_size_bytes: {
          type: 'number',
          description: 'Document file size in bytes',
          optional: true,
        },
      },
    },
    document_annotation: {
      type: 'string',
      description: 'Structured annotation data as JSON string (when applicable)',
      optional: true,
    },
  },
}

/**
 * V3 tool - Updated for new file handling pattern with UserFile normalization
 * Used by MistralParseV3Block which uses fileUpload (basic) and fileReference (advanced) subblocks
 */
export const mistralParserV3Tool: ToolConfig<MistralParserV2Input, MistralParserV2Output> = {
  ...mistralParserV2Tool,
  id: 'mistral_parser_v3',
  version: '3.0.0',
  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'hidden',
      description: 'Normalized UserFile from file upload or file reference',
    },
    resultType: mistralParserTool.params.resultType,
    includeImageBase64: mistralParserTool.params.includeImageBase64,
    pages: mistralParserTool.params.pages,
    imageLimit: mistralParserTool.params.imageLimit,
    imageMinSize: mistralParserTool.params.imageMinSize,
    apiKey: mistralParserTool.params.apiKey,
  },
  request: {
    url: '/api/tools/mistral/parse',
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
        throw new Error('Missing or invalid API key: A valid Mistral API key is required')
      }

      // V3 expects normalized UserFile object via `file` param
      const file = params.file
      if (!file || typeof file !== 'object') {
        throw new Error('File input is required: provide a file upload or file reference')
      }

      const requestBody: Record<string, unknown> = {
        apiKey: params.apiKey,
        resultType: params.resultType || 'markdown',
        file: file,
      }

      if (params.pages) {
        requestBody.pages = params.pages
      }
      if (params.includeImageBase64 !== undefined) {
        requestBody.includeImageBase64 = params.includeImageBase64
      }
      if (params.imageLimit !== undefined) {
        requestBody.imageLimit = params.imageLimit
      }
      if (params.imageMinSize !== undefined) {
        requestBody.imageMinSize = params.imageMinSize
      }

      return requestBody
    },
  },
}
