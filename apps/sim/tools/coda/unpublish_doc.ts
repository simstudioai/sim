import type { CodaDocIdResponse, CodaDocParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaUnpublishDocTool: ToolConfig<CodaDocParams, CodaDocIdResponse> = {
  id: 'coda_unpublish_doc',
  name: 'Coda Unpublish Doc',
  description: 'Unpublish a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'publish')),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { docId: String(params?.docId ?? '').trim() },
  }),

  outputs: {
    docId: { type: 'string', description: 'ID of the unpublished doc' },
  },
}
