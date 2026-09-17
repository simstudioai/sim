import type { CodaPageParams, CodaPageResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  mapPage,
  PAGE_ID_PARAM,
  PAGE_PROPERTIES,
  type RawCodaPage,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetPageTool: ToolConfig<CodaPageParams, CodaPageResponse> = {
  id: 'coda_get_page',
  name: 'Coda Get Page',
  description: 'Get metadata for a page in a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM, pageId: PAGE_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'pages', [params.pageId, 'pageId'])),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaPage
    return { success: true, output: { page: mapPage(data) } }
  },

  outputs: {
    page: { type: 'object', description: 'Page metadata', properties: PAGE_PROPERTIES },
  },
}
