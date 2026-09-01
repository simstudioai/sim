import type { AffinityEntityResponse, AffinityGetNoteParams } from '@/tools/affinity/types'
import { NOTE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetNoteTool: ToolConfig<
  AffinityGetNoteParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_note',
  name: 'Affinity Get Note',
  description: 'Read one note with its body, author, mentions, and attached records.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    noteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The note ID',
    },
    includes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Extra properties to return, e.g. ["repliesCount","personsPreview","companiesPreview","opportunitiesPreview"]. Those four fields are omitted unless requested here',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(`/notes/${encodeURIComponent(requireId(params.noteId, 'noteId'))}`, {
        includes: parseStringList(params.includes, 'includes'),
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: NOTE_OUTPUT_PROPERTIES,
}
