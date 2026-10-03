import type { CodaDocParams, CodaDocResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  DOC_PROPERTIES,
  mapDoc,
  type RawCodaDoc,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetDocTool: ToolConfig<CodaDocParams, CodaDocResponse> = {
  id: 'coda_get_doc',
  name: 'Coda Get Doc',
  description:
    'Get metadata for a Coda doc, including its owner, workspace, folder, size, and publishing settings',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId)),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaDoc
    return { success: true, output: { doc: mapDoc(data) } }
  },

  outputs: {
    doc: { type: 'object', description: 'Doc metadata', properties: DOC_PROPERTIES },
  },
}
