import type { CodaListTablesParams, CodaListTablesResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  joinListParam,
  LIMIT_PARAM,
  mapTableReference,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  type RawCodaTableReference,
  SORT_BY_NAME_PARAM,
  TABLE_REFERENCE_PROPERTIES,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListTablesTool: ToolConfig<CodaListTablesParams, CodaListTablesResponse> = {
  id: 'coda_list_tables',
  name: 'Coda List Tables',
  description: 'List the tables and views in a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableTypes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Table types to include, as an array or comma-separated list of "table", "view", "database" (defaults to all)',
    },
    sortBy: SORT_BY_NAME_PARAM,
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'tables'), {
        tableTypes: joinListParam(params.tableTypes, 'tableTypes'),
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
      items?: RawCodaTableReference[]
      nextPageToken?: string
    }
    return {
      success: true,
      output: {
        tables: (data.items ?? []).map(mapTableReference),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    tables: {
      type: 'array',
      description: 'Tables and views in the doc',
      items: { type: 'object', properties: TABLE_REFERENCE_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
