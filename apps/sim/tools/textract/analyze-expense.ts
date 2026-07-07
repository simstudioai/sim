import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type {
  TextractAnalyzeExpenseOutput,
  TextractAnalyzeExpenseV2Input,
} from '@/tools/textract/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('TextractAnalyzeExpenseTool')

/** Shared shape for AnalyzeExpense fields — used by both summaryFields and lineItemExpenseFields. */
const expenseFieldOutputProperties = {
  type: {
    type: 'object',
    description: 'Normalized field label (e.g., VENDOR_NAME, TOTAL, ITEM, QUANTITY, PRICE)',
    properties: {
      text: { type: 'string', description: 'Field label text' },
      confidence: { type: 'number', description: 'Confidence score (0-100)' },
    },
  },
  valueDetection: {
    type: 'object',
    description: 'Detected value for the field',
    properties: {
      text: { type: 'string', description: 'Field value text' },
      confidence: { type: 'number', description: 'Confidence score (0-100)' },
    },
  },
  labelDetection: {
    type: 'object',
    description: 'The printed label detected next to the value, if any',
    optional: true,
    properties: {
      text: { type: 'string', description: 'Label text' },
      confidence: { type: 'number', description: 'Confidence score (0-100)' },
    },
  },
  pageNumber: { type: 'number', description: 'Page number the field was found on', optional: true },
  currency: {
    type: 'object',
    description: 'Currency of a monetary value, if detected',
    optional: true,
    properties: {
      code: { type: 'string', description: 'ISO currency code (e.g., USD)' },
      confidence: { type: 'number', description: 'Confidence score (0-100)' },
    },
  },
  groupProperties: {
    type: 'array',
    description: 'Grouping metadata (e.g., distinguishes vendor vs. recipient address lines)',
    optional: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Group identifier' },
        types: { type: 'array', description: 'Group type tags', items: { type: 'string' } },
      },
    },
  },
} as const

export const textractAnalyzeExpenseTool: ToolConfig<
  TextractAnalyzeExpenseV2Input,
  TextractAnalyzeExpenseOutput
> = {
  id: 'textract_analyze_expense',
  name: 'AWS Textract Analyze Expense',
  description: 'Extract structured invoice and receipt fields using AWS Textract AnalyzeExpense',
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
    file: {
      type: 'file',
      required: false,
      visibility: 'hidden',
      description: 'Invoice or receipt to be processed (JPEG, PNG, or single-page PDF).',
    },
    s3Uri: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'S3 URI for multi-page processing (s3://bucket/key).',
    },
  },

  request: {
    url: '/api/tools/textract/analyze-expense',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
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
        if (!params.file || typeof params.file !== 'object') {
          throw new Error('Document file is required for single-page processing')
        }
        requestBody.file = params.file
      }

      return requestBody
    },
  },

  transformResponse: async (response) => {
    try {
      const apiResult = await response.json()

      if (!apiResult || typeof apiResult !== 'object') {
        throw new Error('Invalid response format from Textract API')
      }
      if (!apiResult.success) {
        throw new Error(apiResult.error || 'Request failed')
      }

      const data = apiResult.output ?? apiResult

      return {
        success: true,
        output: {
          expenseDocuments: data.expenseDocuments ?? [],
          documentMetadata: { pages: data.documentMetadata?.pages ?? 0 },
          modelVersion: data.modelVersion ?? undefined,
        },
      }
    } catch (error) {
      logger.error('Error processing Textract AnalyzeExpense result:', toError(error))
      throw error
    }
  },

  outputs: {
    expenseDocuments: {
      type: 'array',
      description: 'Detected expense documents with summary fields and line items',
      items: {
        type: 'object',
        properties: {
          expenseIndex: { type: 'number', description: 'Index of the expense document' },
          summaryFields: {
            type: 'array',
            description: 'Header fields such as vendor name, invoice date, and totals',
            items: { type: 'object', properties: expenseFieldOutputProperties },
          },
          lineItemGroups: {
            type: 'array',
            description: 'Groups of line items (e.g., purchased items and their prices)',
            items: {
              type: 'object',
              properties: {
                lineItemGroupIndex: { type: 'number', description: 'Index of the line item group' },
                lineItems: {
                  type: 'array',
                  description: 'Individual line items within the group',
                  items: {
                    type: 'object',
                    properties: {
                      lineItemExpenseFields: {
                        type: 'array',
                        description: 'Fields for a single line item (description, quantity, price)',
                        items: { type: 'object', properties: expenseFieldOutputProperties },
                      },
                    },
                  },
                },
              },
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
      description: 'Version of the AnalyzeExpense model used (multi-page/async only)',
      optional: true,
    },
  },
}
