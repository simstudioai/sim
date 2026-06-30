import type {
  GoogleDocsToolParams,
  GoogleDocsUpdateParagraphStyleResponse,
} from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildContentRange,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

const NAMED_STYLE_TYPES = new Set([
  'NORMAL_TEXT',
  'TITLE',
  'SUBTITLE',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'HEADING_4',
  'HEADING_5',
  'HEADING_6',
])

const ALIGNMENTS = new Set(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'])

export const updateParagraphStyleTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsUpdateParagraphStyleResponse
> = {
  id: 'google_docs_update_paragraph_style',
  name: 'Update Paragraph Style in Google Docs Document',
  description:
    'Apply a named paragraph style (such as a heading or title) and/or alignment to the paragraphs overlapping a range of text in a Google Docs document, identified by its start and end character index.',
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
      description: 'The 1-based start character index of the range to style (inclusive)',
    },
    endIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end character index of the range to style (exclusive)',
    },
    namedStyleType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The named paragraph style to apply. One of: NORMAL_TEXT, TITLE, SUBTITLE, HEADING_1, HEADING_2, HEADING_3, HEADING_4, HEADING_5, HEADING_6.',
    },
    alignment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The paragraph alignment to apply. One of: LEFT, CENTER, RIGHT, JUSTIFY.',
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
      const range = buildContentRange(params.startIndex, params.endIndex)

      const paragraphStyle: Record<string, unknown> = {}
      const fields: string[] = []

      if (params.namedStyleType != null && String(params.namedStyleType).trim() !== '') {
        const namedStyleType = String(params.namedStyleType).trim().toUpperCase()
        if (!NAMED_STYLE_TYPES.has(namedStyleType)) {
          throw new Error(
            'namedStyleType must be one of: NORMAL_TEXT, TITLE, SUBTITLE, HEADING_1, HEADING_2, HEADING_3, HEADING_4, HEADING_5, HEADING_6'
          )
        }
        paragraphStyle.namedStyleType = namedStyleType
        fields.push('namedStyleType')
      }

      if (params.alignment != null && String(params.alignment).trim() !== '') {
        const alignment = String(params.alignment).trim().toUpperCase()
        if (!ALIGNMENTS.has(alignment)) {
          throw new Error('alignment must be one of: LEFT, CENTER, RIGHT, JUSTIFY')
        }
        paragraphStyle.alignment = alignment
        fields.push('alignment')
      }

      if (fields.length === 0) {
        throw new Error('At least one of namedStyleType or alignment must be provided')
      }

      return {
        requests: [
          {
            updateParagraphStyle: {
              range,
              paragraphStyle,
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
      description: 'Indicates if the paragraph style was applied successfully',
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
