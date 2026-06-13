import {
  QUARTR_DOCUMENT_OUTPUT_PROPERTIES,
  type QuartrDocumentDto,
  type QuartrGetDocumentFileResponse,
  type QuartrGetSlideDeckParams,
  type QuartrSingleDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrDocument, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrGetSlideDeckTool: ToolConfig<
  QuartrGetSlideDeckParams,
  QuartrGetDocumentFileResponse
> = {
  id: 'quartr_get_slide_deck',
  name: 'Quartr Get Slide Deck',
  description:
    'Retrieve a slide presentation from Quartr by its document ID and download the PDF file.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    slideDeckId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Quartr document ID of the slide deck (e.g., 432907)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl(`/documents/slides/${encodeURIComponent(String(params.slideDeckId).trim())}`, {
        expand: 'event',
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrSingleDto<QuartrDocumentDto>>(
      response,
      'get slide deck'
    )
    const document = mapQuartrDocument(data.data)

    return {
      success: true,
      output: {
        document,
        fileUrl: document.fileUrl,
        file: {
          name: `quartr-slide-deck-${document.id}.pdf`,
          mimeType: 'application/pdf',
          url: document.fileUrl,
        },
      },
    }
  },

  outputs: {
    document: {
      type: 'object',
      description: 'Slide deck metadata',
      properties: QUARTR_DOCUMENT_OUTPUT_PROPERTIES,
    },
    fileUrl: { type: 'string', description: 'URL of the slide deck PDF' },
    file: {
      type: 'file',
      description: 'Downloaded slide deck PDF stored in execution files',
      fileConfig: { mimeType: 'application/pdf', extension: 'pdf' },
    },
  },
}
