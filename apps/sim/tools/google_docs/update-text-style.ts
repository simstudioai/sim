import type {
  GoogleDocsToolParams,
  GoogleDocsUpdateTextStyleResponse,
} from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  parseOptionalBoolean,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const updateTextStyleTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsUpdateTextStyleResponse
> = {
  id: 'google_docs_update_text_style',
  name: 'Apply Text Style in Google Docs Document',
  description:
    'Apply bold, italic, underline, and/or font size to a range of text in a Google Docs document, identified by its start and end character index.',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-docs',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Docs API',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the document to update',
    },
    startIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zero-based start character index of the range to style (inclusive)',
    },
    endIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end character index of the range to style (exclusive)',
    },
    bold: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to make the text bold',
    },
    italic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to make the text italic',
    },
    underline: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to underline the text',
    },
    fontSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The font size to apply, in points (PT)',
    },
  },
  request: {
    url: (params) => {
      const documentId = resolveDocumentId(params)
      return `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const startIndex = Number(params.startIndex)
      const endIndex = Number(params.endIndex)
      if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) {
        throw new Error('startIndex and endIndex are required')
      }
      if (endIndex <= startIndex) {
        throw new Error('endIndex must be greater than startIndex')
      }

      const textStyle: Record<string, unknown> = {}
      const fields: string[] = []

      const bold = parseOptionalBoolean(params.bold)
      if (bold !== undefined) {
        textStyle.bold = bold
        fields.push('bold')
      }
      const italic = parseOptionalBoolean(params.italic)
      if (italic !== undefined) {
        textStyle.italic = italic
        fields.push('italic')
      }
      const underline = parseOptionalBoolean(params.underline)
      if (underline !== undefined) {
        textStyle.underline = underline
        fields.push('underline')
      }
      const fontSize = Number(params.fontSize)
      if (params.fontSize != null && Number.isFinite(fontSize)) {
        textStyle.fontSize = { magnitude: fontSize, unit: 'PT' }
        fields.push('fontSize')
      }

      if (fields.length === 0) {
        throw new Error(
          'At least one style (bold, italic, underline, or fontSize) must be provided'
        )
      }

      return {
        requests: [
          {
            updateTextStyle: {
              range: { startIndex, endIndex },
              textStyle,
              fields: fields.join(','),
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const data = responseText.trim() ? JSON.parse(responseText) : {}
    const metadata = buildBatchUpdateMetadata(data, response.url)

    return {
      success: true,
      output: {
        updatedContent: true,
        metadata,
      },
    }
  },

  outputs: {
    updatedContent: {
      type: 'boolean',
      description: 'Indicates if the text style was applied successfully',
    },
    metadata: {
      type: 'json',
      description: 'Updated document metadata including ID, title, and URL',
      properties: {
        documentId: { type: 'string', description: 'Google Docs document ID' },
        title: { type: 'string', description: 'Document title' },
        mimeType: { type: 'string', description: 'Document MIME type' },
        url: { type: 'string', description: 'Document URL' },
      },
    },
  },
}
