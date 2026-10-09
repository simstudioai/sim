import {
  type CheckrDocumentResponse,
  type CheckrGetDocumentParams,
  DOCUMENT_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapDocument,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetDocumentTool: ToolConfig<CheckrGetDocumentParams, CheckrDocumentResponse> = {
  id: 'checkr_get_document',
  name: 'Checkr Get Document',
  description:
    'Retrieve a report or candidate document by ID, including a download link valid for 15 minutes.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the document',
    },
  },

  request: {
    url: (params) => checkrUrl(`/documents/${checkrId(params.documentId, 'documentId')}`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { document: mapDocument(data) } }
  },

  outputs: {
    document: { type: 'object', description: 'The document', properties: DOCUMENT_PROPERTIES },
  },
}
