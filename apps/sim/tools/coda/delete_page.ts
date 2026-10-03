import type { CodaPageMutationResponse, CodaPageParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  PAGE_ID_PARAM,
  REQUEST_ID_OUTPUT,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaDeletePageTool: ToolConfig<CodaPageParams, CodaPageMutationResponse> = {
  id: 'coda_delete_page',
  name: 'Coda Delete Page',
  description: 'Delete a page from a Coda doc. Applied asynchronously.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM, pageId: PAGE_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'pages', [params.pageId, 'pageId'])),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; id: string }
    return { success: true, output: { requestId: data.requestId, pageId: data.id } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    pageId: { type: 'string', description: 'ID of the deleted page' },
  },
}
