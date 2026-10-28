import {
  type CheckrListCandidateDocumentsParams,
  type CheckrListDocumentsResponse,
  DOCUMENT_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapDocument,
  parseCheckrStringList,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListCandidateDocumentsTool: ToolConfig<
  CheckrListCandidateDocumentsParams,
  CheckrListDocumentsResponse
> = {
  id: 'checkr_list_candidate_documents',
  name: 'Checkr List Candidate Documents',
  description:
    'List documents a candidate provided, such as driver licenses and consent forms. Download links expire after 15 minutes.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate',
    },
    documentTypes: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return these document types, e.g. driver_license, consent',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        checkrUrl(`/candidates/${checkrId(params.candidateId, 'candidateId')}/documents`)
      )
      for (const type of parseCheckrStringList(params.documentTypes) ?? []) {
        url.searchParams.append('types[]', type)
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        documents: (Array.isArray(data.data) ? data.data : []).map(mapDocument),
        count: typeof data.count === 'number' ? data.count : null,
      },
    }
  },

  outputs: {
    documents: {
      type: 'array',
      description: 'Candidate documents',
      items: { type: 'object', properties: DOCUMENT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of documents', nullable: true },
  },
}
