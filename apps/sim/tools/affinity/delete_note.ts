import type {
  AffinityAcknowledgementResponse,
  AffinityDeleteNoteParams,
} from '@/tools/affinity/types'
import { ACKNOWLEDGEMENT_OUTPUTS } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformAcknowledgement,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityDeleteNoteTool: ToolConfig<
  AffinityDeleteNoteParams,
  AffinityAcknowledgementResponse
> = {
  id: 'affinity_delete_note',
  name: 'Affinity Delete Note',
  description:
    'Delete a note you created. Deleting a root note also deletes its replies; deleting a reply removes only that reply.',
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
      description: 'The note ID to delete',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(`/notes/${encodeURIComponent(requireId(params.noteId, 'noteId'))}`),
    method: 'DELETE',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformAcknowledgement((params) => String(params.noteId ?? '')),

  outputs: ACKNOWLEDGEMENT_OUTPUTS,
}
