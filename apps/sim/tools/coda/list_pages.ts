import type { CodaListPagesParams, CodaListPagesResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  LIMIT_PARAM,
  mapPage,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_PROPERTIES,
  PAGE_TOKEN_PARAM,
  type RawCodaPage,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListPagesTool: ToolConfig<CodaListPagesParams, CodaListPagesResponse> = {
  id: 'coda_list_pages',
  name: 'Coda List Pages',
  description: 'List the pages in a Coda doc, including their hierarchy',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'pages'), {
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { items?: RawCodaPage[]; nextPageToken?: string }
    return {
      success: true,
      output: {
        pages: (data.items ?? []).map(mapPage),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    pages: {
      type: 'array',
      description: 'Pages in the doc',
      items: { type: 'object', properties: PAGE_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
