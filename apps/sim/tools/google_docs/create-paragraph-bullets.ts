import type {
  GoogleDocsCreateParagraphBulletsResponse,
  GoogleDocsToolParams,
} from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildContentRange,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

const BULLET_PRESETS = new Set([
  'BULLET_DISC_CIRCLE_SQUARE',
  'BULLET_DIAMONDX_ARROW3D_SQUARE',
  'BULLET_CHECKBOX',
  'BULLET_ARROW_DIAMOND_DISC',
  'BULLET_STAR_CIRCLE_SQUARE',
  'BULLET_ARROW3D_CIRCLE_SQUARE',
  'NUMBERED_DECIMAL_ALPHA_ROMAN',
  'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS',
  'NUMBERED_DECIMAL_NESTED',
  'NUMBERED_UPPERALPHA_ALPHA_ROMAN',
  'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL',
  'NUMBERED_ZERODECIMAL_ALPHA_ROMAN',
])

const DEFAULT_BULLET_PRESET = 'BULLET_DISC_CIRCLE_SQUARE'

export const createParagraphBulletsTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsCreateParagraphBulletsResponse
> = {
  id: 'google_docs_create_paragraph_bullets',
  name: 'Create Paragraph Bullets in Google Docs Document',
  description:
    'Add bulleted or numbered list formatting to the paragraphs overlapping a range of text in a Google Docs document, using a chosen bullet glyph preset.',
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
      description:
        'The start character index (the document body starts at index 1) of the range to bullet (inclusive)',
    },
    endIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end character index of the range to bullet (exclusive)',
    },
    bulletPreset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The bullet glyph preset to apply. Defaults to BULLET_DISC_CIRCLE_SQUARE. Examples: BULLET_DISC_CIRCLE_SQUARE, BULLET_CHECKBOX, NUMBERED_DECIMAL_ALPHA_ROMAN, NUMBERED_DECIMAL_NESTED.',
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

      let bulletPreset = DEFAULT_BULLET_PRESET
      if (params.bulletPreset != null && String(params.bulletPreset).trim() !== '') {
        bulletPreset = String(params.bulletPreset).trim().toUpperCase()
        if (!BULLET_PRESETS.has(bulletPreset)) {
          throw new Error(
            'bulletPreset must be a valid BulletGlyphPreset (e.g. BULLET_DISC_CIRCLE_SQUARE, BULLET_CHECKBOX, NUMBERED_DECIMAL_ALPHA_ROMAN)'
          )
        }
      }

      return {
        requests: [
          {
            createParagraphBullets: { range, bulletPreset },
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
      description: 'Indicates if the bullets were applied successfully',
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
