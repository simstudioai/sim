import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { TextractAnalyzeIdOutput, TextractAnalyzeIdV2Input } from '@/tools/textract/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('TextractAnalyzeIdTool')

export const textractAnalyzeIdTool: ToolConfig<TextractAnalyzeIdV2Input, TextractAnalyzeIdOutput> =
  {
    id: 'textract_analyze_id',
    name: 'AWS Textract Analyze ID',
    description: 'Extract identity document fields using AWS Textract AnalyzeID',
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
      file: {
        type: 'file',
        required: false,
        visibility: 'hidden',
        description: 'Front of the identity document (JPEG, PNG, or PDF).',
      },
      filePath: {
        type: 'string',
        required: false,
        visibility: 'hidden',
        description: 'URL to the front of the identity document, if not uploaded directly.',
      },
      fileBack: {
        type: 'file',
        required: false,
        visibility: 'hidden',
        description: 'Back of the identity document, if applicable (JPEG, PNG, or PDF).',
      },
      filePathBack: {
        type: 'string',
        required: false,
        visibility: 'hidden',
        description: 'URL to the back of the identity document, if not uploaded directly.',
      },
    },

    request: {
      url: '/api/tools/textract/analyze-id',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const requestBody: Record<string, unknown> = {
          accessKeyId: params.accessKeyId?.trim(),
          secretAccessKey: params.secretAccessKey?.trim(),
          region: params.region?.trim(),
        }

        if (params.file && typeof params.file === 'object') {
          requestBody.file = params.file
        } else if (params.filePath && params.filePath.trim() !== '') {
          requestBody.filePath = params.filePath.trim()
        } else {
          throw new Error('Identity document is required')
        }

        if (params.fileBack && typeof params.fileBack === 'object') {
          requestBody.fileBack = params.fileBack
        } else if (params.filePathBack && params.filePathBack.trim() !== '') {
          requestBody.filePathBack = params.filePathBack.trim()
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
            identityDocuments: data.identityDocuments ?? [],
            documentMetadata: { pages: data.documentMetadata?.pages ?? 0 },
            modelVersion: data.modelVersion ?? undefined,
          },
        }
      } catch (error) {
        logger.error('Error processing Textract AnalyzeID result:', toError(error))
        throw error
      }
    },

    outputs: {
      identityDocuments: {
        type: 'array',
        description: 'Detected identity documents with normalized fields',
        items: {
          type: 'object',
          properties: {
            documentIndex: { type: 'number', description: 'Index of the document page set' },
            identityDocumentFields: {
              type: 'array',
              description:
                'Normalized fields such as FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, DOCUMENT_NUMBER, EXPIRATION_DATE',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'object',
                    description: 'Normalized field label',
                    properties: {
                      text: { type: 'string', description: 'Field label text' },
                      confidence: { type: 'number', description: 'Confidence score (0-100)' },
                    },
                  },
                  valueDetection: {
                    type: 'object',
                    description: 'Detected value for the field, with a normalized value for dates',
                    properties: {
                      text: { type: 'string', description: 'Field value text' },
                      confidence: { type: 'number', description: 'Confidence score (0-100)' },
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
          pages: { type: 'number', description: 'Number of pages analyzed' },
        },
      },
      modelVersion: {
        type: 'string',
        description: 'Version of the AnalyzeID model used for processing',
        optional: true,
      },
    },
  }
