import type { CodaListControlsResponse, CodaListDocItemsParams } from '@/tools/coda/types'
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

export const codaListControlsTool: ToolConfig<CodaListDocItemsParams, CodaListControlsResponse> = {
  id: 'coda_list_controls',
  name: 'Coda List Controls',
  description:
    'List the controls (sliders, selects, checkboxes, date pickers, buttons, etc.) in a Coda doc',
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
      buildCodaUrl(codaDocPath(params.docId, 'controls'), {
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
        controls: (data.items ?? []).map(mapNamedReference),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    controls: {
      type: 'array',
      description: 'Controls in the doc',
      items: { type: 'object', properties: NAMED_REFERENCE_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
