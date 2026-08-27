import type {
  AffinityAcknowledgementResponse,
  AffinityUpdateNoteParams,
} from '@/tools/affinity/types'
import { ACKNOWLEDGEMENT_OUTPUTS } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  toIdReferencesPreservingEmpty,
  transformAcknowledgement,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityUpdateNoteTool: ToolConfig<
  AffinityUpdateNoteParams,
  AffinityAcknowledgementResponse
> = {
  id: 'affinity_update_note',
  name: 'Affinity Update Note',
  description:
    "Rewrite a note's body or replace which records it is attached to. Each list of IDs replaces that association wholesale, an empty list clears it, and omitting one leaves it untouched. A note's type cannot be changed.",
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
      description: 'The note ID to update',
    },
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement note body as HTML',
    },
    companyIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement set of attached companies, e.g. [1, 2]. Send [] to detach every company; omit to leave them unchanged',
    },
    personIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement set of attached persons, e.g. [1, 2]. Send [] to detach every person; omit to leave them unchanged',
    },
    opportunityIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement set of attached opportunities, e.g. [1, 2]. Send [] to detach every opportunity; omit to leave them unchanged',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(`/notes/${encodeURIComponent(requireId(params.noteId, 'noteId'))}`),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.html) body.content = { html: params.html }

      const companies = toIdReferencesPreservingEmpty(params.companyIds, 'companyIds')
      const persons = toIdReferencesPreservingEmpty(params.personIds, 'personIds')
      const opportunities = toIdReferencesPreservingEmpty(params.opportunityIds, 'opportunityIds')
      if (companies !== undefined) body.companies = companies
      if (persons !== undefined) body.persons = persons
      if (opportunities !== undefined) body.opportunities = opportunities

      if (Object.keys(body).length === 0) {
        throw new Error('Affinity Update Note needs a new body or a new set of attached records')
      }
      return body
    },
  },

  transformResponse: transformAcknowledgement((params) => String(params.noteId ?? '')),

  outputs: ACKNOWLEDGEMENT_OUTPUTS,
}
