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

export const codaDeleteDocTool: ToolConfig<CodaDocParams, CodaDocIdResponse> = {
  id: 'coda_delete_doc',
  name: 'Coda Delete Doc',
  description: 'Delete a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId)),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { docId: String(params?.docId ?? '').trim() },
  }),

  outputs: {
    docId: { type: 'string', description: 'ID of the deleted doc' },
  },
}
