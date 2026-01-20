import { createLogger } from '@sim/logger'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { TextractParserInput, TextractParserOutput } from '@/tools/textract/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('TextractParserTool')

export const textractParserTool: ToolConfig<TextractParserInput, TextractParserOutput> = {
  id: 'textract_parser',
  name: 'AWS Textract Parser',
  description: 'Parse documents using AWS Textract OCR and document analysis',
  version: '1.0.0',

  params: {
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS Access Key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS Secret Access Key',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region for Textract service (e.g., us-east-1)',
    },
    processingMode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Document type: single-page or multi-page. Defaults to single-page.',
    },
    filePath: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'URL to a document to be processed (JPEG, PNG, or single-page PDF).',
    },
    s3Uri: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'S3 URI for multi-page processing (s3://bucket/key).',
    },
    fileUpload: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'File upload data from file-upload component',
    },
    featureTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Feature types to detect: TABLES, FORMS, QUERIES, SIGNATURES, LAYOUT. If not specified, only text detection is performed.',
      items: {
        type: 'string',
        description: 'Feature type',
      },
    },
    queries: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom queries to extract specific information. Only used when featureTypes includes QUERIES.',
      items: {
        type: 'object',
        description: 'Query configuration',
        properties: {
          Text: { type: 'string', description: 'The query text' },
          Alias: { type: 'string', description: 'Optional alias for the result' },
        },
      },
    },
  },

  request: {
    url: '/api/tools/textract/parse',
    method: 'POST',
    headers: () => {
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
    },
    body: (params) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid parameters: Parameters must be provided as an object')
      }

      if (
        !params.accessKeyId ||
        typeof params.accessKeyId !== 'string' ||
        params.accessKeyId.trim() === ''
      ) {
        throw new Error('Missing or invalid AWS Access Key ID')
      }

      if (
        !params.secretAccessKey ||
        typeof params.secretAccessKey !== 'string' ||
        params.secretAccessKey.trim() === ''
      ) {
        throw new Error('Missing or invalid AWS Secret Access Key')
      }

      if (!params.region || typeof params.region !== 'string' || params.region.trim() === '') {
        throw new Error('Missing or invalid AWS region')
      }

      const processingMode = params.processingMode || 'sync'

      const requestBody: Record<string, unknown> = {
        accessKeyId: params.accessKeyId.trim(),
        secretAccessKey: params.secretAccessKey.trim(),
        region: params.region.trim(),
        processingMode,
      }

      if (processingMode === 'async') {
        if (params.s3Uri && typeof params.s3Uri === 'string' && params.s3Uri.trim() !== '') {
          const s3UriTrimmed = params.s3Uri.trim()
          if (!s3UriTrimmed.match(/^s3:\/\/[^/]+\/.+$/)) {
            throw new Error('Invalid S3 URI format. Expected: s3://bucket-name/path/to/object')
          }
          requestBody.s3Uri = s3UriTrimmed
        } else if (params.fileUpload) {
          if (
            typeof params.fileUpload === 'object' &&
            params.fileUpload !== null &&
            (params.fileUpload.url || params.fileUpload.path)
          ) {
            const uploadedFilePath = (params.fileUpload.path || params.fileUpload.url) as string
            if (uploadedFilePath.startsWith('/api/files/serve/')) {
              requestBody.filePath = uploadedFilePath
            } else {
              throw new Error('Multi-page mode with upload requires files stored in S3')
            }
          } else {
            throw new Error('Invalid file upload: Upload data is missing or invalid')
          }
        } else {
          throw new Error('Multi-page mode requires either an S3 URI or an uploaded file')
        }
      } else {
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
          throw new Error('Missing or invalid file path: Please provide a URL to a document')
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
            throw new Error(
              `Invalid protocol: ${url.protocol}. URL must use HTTP or HTTPS protocol`
            )
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Invalid URL format: ${errorMessage}. Please provide a valid HTTP or HTTPS URL to a document.`
          )
        }

        requestBody.filePath = url.toString()

        if (params.fileUpload?.path?.startsWith('/api/files/serve/')) {
          requestBody.filePath = params.fileUpload.path
        }
      }

      if (params.featureTypes && Array.isArray(params.featureTypes)) {
        const validFeatures = ['TABLES', 'FORMS', 'QUERIES', 'SIGNATURES', 'LAYOUT']
        const filteredFeatures = params.featureTypes.filter((f) =>
          validFeatures.includes(f as string)
        )
        if (filteredFeatures.length > 0) {
          requestBody.featureTypes = filteredFeatures
        }
      }

      if (params.queries && Array.isArray(params.queries) && params.queries.length > 0) {
        const validQueries = params.queries
          .filter((q) => q && typeof q === 'object' && typeof q.Text === 'string' && q.Text.trim())
          .map((q) => ({
            Text: q.Text.trim(),
            Alias: q.Alias?.trim() || undefined,
            Pages: q.Pages || undefined,
          }))

        if (validQueries.length > 0) {
          requestBody.queries = validQueries

          if (!requestBody.featureTypes) {
            requestBody.featureTypes = ['QUERIES']
          } else if (
            Array.isArray(requestBody.featureTypes) &&
            !requestBody.featureTypes.includes('QUERIES')
          ) {
            ;(requestBody.featureTypes as string[]).push('QUERIES')
          }
        }
      }

      return requestBody
    },
  },

  transformResponse: async (response) => {
    try {
      let apiResult
      try {
        apiResult = await response.json()
      } catch (jsonError) {
        throw new Error(
          `Failed to parse Textract response: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`
        )
      }

      if (!apiResult || typeof apiResult !== 'object') {
        throw new Error('Invalid response format from Textract API')
      }

      if (!apiResult.success && apiResult.error) {
        throw new Error(apiResult.error)
      }

      const textractData = apiResult.output ?? apiResult

      return {
        success: true,
        output: {
          blocks: textractData.Blocks ?? textractData.blocks ?? [],
          documentMetadata: {
            pages:
              textractData.DocumentMetadata?.Pages ?? textractData.documentMetadata?.pages ?? 0,
          },
          modelVersion:
            textractData.AnalyzeDocumentModelVersion ??
            textractData.analyzeDocumentModelVersion ??
            textractData.DetectDocumentTextModelVersion ??
            textractData.detectDocumentTextModelVersion ??
            undefined,
        },
      }
    } catch (error) {
      logger.error('Error processing Textract result:', error)
      throw error
    }
  },

  outputs: {
    blocks: {
      type: 'array',
      description:
        'Array of Block objects containing detected text, tables, forms, and other elements',
      items: {
        type: 'object',
        properties: {
          BlockType: {
            type: 'string',
            description: 'Type of block (PAGE, LINE, WORD, TABLE, CELL, KEY_VALUE_SET, etc.)',
          },
          Id: { type: 'string', description: 'Unique identifier for the block' },
          Text: {
            type: 'string',
            description: 'The text content (for LINE and WORD blocks)',
            optional: true,
          },
          TextType: {
            type: 'string',
            description: 'Type of text (PRINTED or HANDWRITING)',
            optional: true,
          },
          Confidence: { type: 'number', description: 'Confidence score (0-100)', optional: true },
          Page: { type: 'number', description: 'Page number', optional: true },
          Geometry: {
            type: 'object',
            description: 'Location and bounding box information',
            optional: true,
            properties: {
              BoundingBox: {
                type: 'object',
                properties: {
                  Height: { type: 'number', description: 'Height as ratio of document height' },
                  Left: { type: 'number', description: 'Left position as ratio of document width' },
                  Top: { type: 'number', description: 'Top position as ratio of document height' },
                  Width: { type: 'number', description: 'Width as ratio of document width' },
                },
              },
              Polygon: {
                type: 'array',
                description: 'Polygon coordinates',
                items: {
                  type: 'object',
                  properties: {
                    X: { type: 'number', description: 'X coordinate' },
                    Y: { type: 'number', description: 'Y coordinate' },
                  },
                },
              },
            },
          },
          Relationships: {
            type: 'array',
            description: 'Relationships to other blocks',
            optional: true,
            items: {
              type: 'object',
              properties: {
                Type: {
                  type: 'string',
                  description: 'Relationship type (CHILD, VALUE, ANSWER, etc.)',
                },
                Ids: { type: 'array', description: 'IDs of related blocks' },
              },
            },
          },
          EntityTypes: {
            type: 'array',
            description: 'Entity types for KEY_VALUE_SET (KEY or VALUE)',
            optional: true,
          },
          SelectionStatus: {
            type: 'string',
            description: 'For checkboxes: SELECTED or NOT_SELECTED',
            optional: true,
          },
          RowIndex: { type: 'number', description: 'Row index for table cells', optional: true },
          ColumnIndex: {
            type: 'number',
            description: 'Column index for table cells',
            optional: true,
          },
          RowSpan: { type: 'number', description: 'Row span for merged cells', optional: true },
          ColumnSpan: {
            type: 'number',
            description: 'Column span for merged cells',
            optional: true,
          },
          Query: {
            type: 'object',
            description: 'Query information for QUERY blocks',
            optional: true,
            properties: {
              Text: { type: 'string', description: 'Query text' },
              Alias: { type: 'string', description: 'Query alias', optional: true },
              Pages: { type: 'array', description: 'Pages to search', optional: true },
            },
          },
        },
      },
    },
    documentMetadata: {
      type: 'object',
      description: 'Metadata about the analyzed document',
      properties: {
        pages: { type: 'number', description: 'Number of pages in the document' },
      },
    },
    modelVersion: {
      type: 'string',
      description: 'Version of the Textract model used for processing',
      optional: true,
    },
  },
}
