import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { MistralParserInput, MistralParserOutput } from '@/tools/mistral/types'
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
    url: 'https://api.mistral.ai/v1/ocr',
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

      // Validate required parameters
      if (!params.apiKey || typeof params.apiKey !== 'string' || params.apiKey.trim() === '') {
        throw new Error('Missing or invalid API key: A valid Mistral API key is required')
      }

      // Check if we have a file upload instead of direct URL
      if (
        params.fileUpload &&
        (!params.filePath || params.filePath === 'null' || params.filePath === '')
      ) {
        // Try to extract file path from upload data
        if (
          typeof params.fileUpload === 'object' &&
          params.fileUpload !== null &&
          (params.fileUpload.url || params.fileUpload.path)
        ) {
          // Get the full URL to the file - prefer url over path for UserFile compatibility
          let uploadedFilePath = params.fileUpload.url || params.fileUpload.path

          // Make sure the file path is an absolute URL
          if (uploadedFilePath.startsWith('/')) {
            // If it's a relative path starting with /, convert to absolute URL
            const baseUrl = getBaseUrl()
            if (!baseUrl) throw new Error('Failed to get base URL for file path conversion')
            uploadedFilePath = `${baseUrl}${uploadedFilePath}`
          }

          // Set the filePath parameter
          params.filePath = uploadedFilePath
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

      // Validate and normalize URL
      let url
      try {
        url = new URL(params.filePath.trim())

        // Validate protocol
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error(`Invalid protocol: ${url.protocol}. URL must use HTTP or HTTPS protocol`)
        }

        // Validate against known unsupported services
        if (url.hostname.includes('drive.google.com') || url.hostname.includes('docs.google.com')) {
          throw new Error(
            'Google Drive links are not supported by the Mistral OCR API. ' +
              'Please upload your PDF to a public web server or provide a direct download link ' +
              'that ends with .pdf extension.'
          )
        }

        // Validate file appears to be a PDF (stricter check with informative warning)
        const pathname = url.pathname.toLowerCase()
        if (!pathname.endsWith('.pdf')) {
          // Check if PDF is included in the path at all
          if (!pathname.includes('pdf')) {
            logger.warn(
              'Warning: URL does not appear to point to a PDF document. ' +
                'The Mistral OCR API is designed to work with PDF files. ' +
                'Please ensure your URL points to a valid PDF document (ideally ending with .pdf extension).'
            )
          } else {
            // If "pdf" is in the URL but not at the end, give a different warning
            logger.warn(
              'Warning: URL contains "pdf" but does not end with .pdf extension. ' +
                'This might still work if the server returns a valid PDF document despite the missing extension.'
            )
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Invalid URL format: ${errorMessage}. Please provide a valid HTTP or HTTPS URL to a PDF document (e.g., https://example.com/document.pdf)`
        )
      }

      // Create the request body with required parameters
      const requestBody: Record<string, any> = {
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          document_url: url.toString(),
        },
      }

      // Add optional parameters with proper validation
      // Include images (base64)
      if (params.includeImageBase64 !== undefined) {
        if (typeof params.includeImageBase64 !== 'boolean') {
          logger.warn('includeImageBase64 parameter should be a boolean, using default (false)')
        } else {
          requestBody.include_image_base64 = params.includeImageBase64
        }
      }

      // Page selection - safely handle null and undefined
      if (params.pages !== undefined && params.pages !== null) {
        if (Array.isArray(params.pages) && params.pages.length > 0) {
          // Validate all page numbers are non-negative integers
          const validPages = params.pages.filter(
            (page) => typeof page === 'number' && Number.isInteger(page) && page >= 0
          )

          if (validPages.length > 0) {
            requestBody.pages = validPages

            if (validPages.length !== params.pages.length) {
              logger.warn(
                `Some invalid page numbers were removed. Using ${validPages.length} valid pages: ${validPages.join(', ')}`
              )
            }
          } else {
            logger.warn('No valid page numbers provided, processing all pages')
          }
        } else if (Array.isArray(params.pages) && params.pages.length === 0) {
          logger.warn('Empty pages array provided, processing all pages')
        }
      }

      // Image limit - safely handle null and undefined
      if (params.imageLimit !== undefined && params.imageLimit !== null) {
        const imageLimit = Number(params.imageLimit)
        if (Number.isInteger(imageLimit) && imageLimit > 0) {
          requestBody.image_limit = imageLimit
        } else {
          logger.warn('imageLimit must be a positive integer, ignoring this parameter')
        }
      }

      // Minimum image size - safely handle null and undefined
      if (params.imageMinSize !== undefined && params.imageMinSize !== null) {
        const imageMinSize = Number(params.imageMinSize)
        if (Number.isInteger(imageMinSize) && imageMinSize > 0) {
          requestBody.image_min_size = imageMinSize
        } else {
          logger.warn('imageMinSize must be a positive integer, ignoring this parameter')
        }
      }

      // Log the request (with sensitive data redacted)
      logger.info('Mistral OCR request:', {
        url: url.toString(),
        hasApiKey: !!params.apiKey,
        model: requestBody.model,
        options: {
          includesImages: requestBody.include_image_base64 ?? 'not specified',
          pages: requestBody.pages ?? 'all pages',
          imageLimit: requestBody.image_limit ?? 'no limit',
          imageMinSize: requestBody.image_min_size ?? 'no minimum',
        },
      })

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

      // Set default values and extract from params if available
      let resultType: 'markdown' | 'text' | 'json' = 'markdown'
      let sourceUrl = ''
      let isFileUpload = false

      if (params && typeof params === 'object') {
        if (params.filePath && typeof params.filePath === 'string') {
          sourceUrl = params.filePath.trim()
        }

        // Check if this was a file upload
        isFileUpload = !!params.fileUpload

        if (params.resultType && ['markdown', 'text', 'json'].includes(params.resultType)) {
          resultType = params.resultType as 'markdown' | 'text' | 'json'
        }
      } else if (
        ocrResult.document &&
        typeof ocrResult.document === 'object' &&
        ocrResult.document.document_url &&
        typeof ocrResult.document.document_url === 'string'
      ) {
        sourceUrl = ocrResult.document.document_url
      }

      // Process content from pages
      let content = ''
      const pageCount =
        ocrResult.pages && Array.isArray(ocrResult.pages) ? ocrResult.pages.length : 0

      if (pageCount > 0) {
        content = ocrResult.pages
          .map((page: any) => (page && typeof page.markdown === 'string' ? page.markdown : ''))
          .filter(Boolean)
          .join('\n\n')
      } else {
        logger.warn('No pages found in OCR result, returning raw response')
        content = JSON.stringify(ocrResult, null, 2)
      }

      // Process based on requested result type
      if (resultType === 'text') {
        // Strip markdown formatting
        content = content
          .replace(/##*\s/g, '') // Remove markdown headers
          .replace(/\*\*/g, '') // Remove bold markers
          .replace(/\*/g, '') // Remove italic markers
          .replace(/\n{3,}/g, '\n\n') // Normalize newlines
      } else if (resultType === 'json') {
        // Return the structured data as JSON string
        content = JSON.stringify(ocrResult, null, 2)
      }

      // Extract file information with proper validation
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

      // Generate a tracking ID with timestamp and random component for uniqueness
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(2, 10)
      const jobId = `mistral-ocr-${timestamp}-${randomId}`

      // Map API response fields to our schema with proper type checking
      const usageInfo =
        ocrResult.usage_info && typeof ocrResult.usage_info === 'object'
          ? {
              pagesProcessed:
                typeof ocrResult.usage_info.pages_processed === 'number'
                  ? ocrResult.usage_info.pages_processed
                  : Number(ocrResult.usage_info.pages_processed),
              docSizeBytes:
                typeof ocrResult.usage_info.doc_size_bytes === 'number'
                  ? ocrResult.usage_info.doc_size_bytes
                  : Number(ocrResult.usage_info.doc_size_bytes),
            }
          : undefined

      // Create metadata object
      const metadata: any = {
        jobId,
        fileType,
        fileName,
        source: 'url',
        pageCount,
        usageInfo,
        model: typeof ocrResult.model === 'string' ? ocrResult.model : 'mistral-ocr-latest',
        resultType,
        processedAt: new Date().toISOString(),
      }

      // Only include sourceUrl for non-file-upload sources or URLs that don't contain our API endpoint
      if (
        !isFileUpload &&
        sourceUrl &&
        !sourceUrl.includes('/api/files/serve/') &&
        !sourceUrl.includes('s3.amazonaws.com')
      ) {
        metadata.sourceUrl = sourceUrl
      }

      // Return properly structured response
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
    },
  },
}
