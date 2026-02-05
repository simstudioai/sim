import { createLogger } from '@sim/logger'
import type {
  TextractParserInput,
  TextractParserOutput,
  TextractParserV2Input,
} from '@/tools/textract/types'
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
    file: {
      type: 'file',
      required: false,
      visibility: 'hidden',
      description: 'Document file to be processed (JPEG, PNG, or single-page PDF).',
    },
    s3Uri: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'S3 URI for multi-page processing (s3://bucket/key).',
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
      const processingMode = params.processingMode || 'sync'

      const requestBody: Record<string, unknown> = {
        accessKeyId: params.accessKeyId?.trim(),
        secretAccessKey: params.secretAccessKey?.trim(),
        region: params.region?.trim(),
        processingMode,
      }

      if (processingMode === 'async') {
        requestBody.s3Uri = params.s3Uri?.trim()
      } else {
        const fileInput =
          params.file && typeof params.file === 'object' ? params.file : params.fileUpload
        const hasFileUpload = fileInput && typeof fileInput === 'object'
        const hasFilePath = typeof params.filePath === 'string' && params.filePath.trim() !== ''

        if (hasFilePath) {
          requestBody.filePath = params.filePath?.trim()
        } else if (hasFileUpload) {
          requestBody.file = fileInput
        } else {
          throw new Error('Document is required for single-page processing')
        }
      }

      if (params.featureTypes && Array.isArray(params.featureTypes)) {
        requestBody.featureTypes = params.featureTypes
      }

      if (params.queries && Array.isArray(params.queries)) {
        requestBody.queries = params.queries
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

      if (!apiResult.success) {
        throw new Error(apiResult.error || 'Request failed')
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
            textractData.modelVersion ??
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

export const textractParserV2Tool: ToolConfig<TextractParserV2Input, TextractParserOutput> = {
  ...textractParserTool,
  id: 'textract_parser_v2',
  name: 'AWS Textract Parser',
  params: {
    accessKeyId: textractParserTool.params.accessKeyId,
    secretAccessKey: textractParserTool.params.secretAccessKey,
    region: textractParserTool.params.region,
    processingMode: textractParserTool.params.processingMode,
    file: {
      type: 'file',
      required: false,
      visibility: 'hidden',
      description: 'Document to be processed (JPEG, PNG, or single-page PDF).',
    },
    s3Uri: textractParserTool.params.s3Uri,
    featureTypes: textractParserTool.params.featureTypes,
    queries: textractParserTool.params.queries,
  },
  request: {
    ...textractParserTool.request,
    body: (params: TextractParserV2Input) => {
      const processingMode = params.processingMode || 'sync'

      const requestBody: Record<string, unknown> = {
        accessKeyId: params.accessKeyId?.trim(),
        secretAccessKey: params.secretAccessKey?.trim(),
        region: params.region?.trim(),
        processingMode,
      }

      if (processingMode === 'async') {
        requestBody.s3Uri = params.s3Uri?.trim()
      } else {
        if (!params.file || typeof params.file !== 'object') {
          throw new Error('Document file is required for single-page processing')
        }
        requestBody.file = params.file
      }

      if (params.featureTypes && Array.isArray(params.featureTypes)) {
        requestBody.featureTypes = params.featureTypes
      }

      if (params.queries && Array.isArray(params.queries)) {
        requestBody.queries = params.queries
      }

      return requestBody
    },
  },
}
