import {
  QUARTR_DOCUMENT_OUTPUT_PROPERTIES,
  type QuartrDocumentDto,
  type QuartrGetDocumentFileResponse,
  type QuartrGetTranscriptParams,
  type QuartrSingleDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrDocument, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrGetTranscriptTool: ToolConfig<
  QuartrGetTranscriptParams,
  QuartrGetDocumentFileResponse
> = {
  id: 'quartr_get_transcript',
  name: 'Quartr Get Transcript',
  description:
    'Retrieve an event transcript from Quartr by its document ID and download the transcript JSON file (paragraphs, sentences, timestamps, and speaker identification).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    transcriptId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Quartr document ID of the transcript (e.g., 432907)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl(
        `/documents/transcripts/${encodeURIComponent(String(params.transcriptId).trim())}`,
        { expand: 'event' }
      ),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrSingleDto<QuartrDocumentDto>>(
      response,
      'get transcript'
    )
    const document = mapQuartrDocument(data.data)

    return {
      success: true,
      output: {
        document,
        fileUrl: document.fileUrl,
        file: {
          name: `quartr-transcript-${document.id}.json`,
          mimeType: 'application/json',
          url: document.fileUrl,
        },
      },
    }
  },

  outputs: {
    document: {
      type: 'object',
      description: 'Transcript metadata',
      properties: QUARTR_DOCUMENT_OUTPUT_PROPERTIES,
    },
    fileUrl: { type: 'string', description: 'URL of the transcript JSON file' },
    file: {
      type: 'file',
      description: 'Downloaded transcript JSON file stored in execution files',
      fileConfig: { mimeType: 'application/json', extension: 'json' },
    },
  },
}
