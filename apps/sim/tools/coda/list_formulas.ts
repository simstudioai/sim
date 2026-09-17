import type { CodaListDocItemsParams, CodaListFormulasResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  LIMIT_PARAM,
  mapNamedReference,
  NAMED_REFERENCE_PROPERTIES,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  type RawCodaNamedReference,
  SORT_BY_NAME_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListFormulasTool: ToolConfig<CodaListDocItemsParams, CodaListFormulasResponse> = {
  id: 'coda_list_formulas',
  name: 'Coda List Formulas',
  description: 'List the named formulas in a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    sortBy: SORT_BY_NAME_PARAM,
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'formulas'), {
        sortBy: params.sortBy,
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      items?: RawCodaNamedReference[]
      nextPageToken?: string
    }
    return {
      success: true,
      output: {
        formulas: (data.items ?? []).map(mapNamedReference),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    formulas: {
      type: 'array',
      description: 'Named formulas in the doc',
      items: { type: 'object', properties: NAMED_REFERENCE_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
