import type { CodaGetTableParams, CodaTableResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  mapTable,
  type RawCodaTable,
  TABLE_ID_PARAM,
  TABLE_PROPERTIES,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetTableTool: ToolConfig<CodaGetTableParams, CodaTableResponse> = {
  id: 'coda_get_table',
  name: 'Coda Get Table',
  description:
    'Get details about a table or view in a Coda doc, including its row count, sorts, layout, and filter',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    useUpdatedTableLayouts: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Report detail and form layouts as "detail" and "form" instead of "masterDetail" for both',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'tables', [params.tableId, 'tableId']), {
        useUpdatedTableLayouts: params.useUpdatedTableLayouts,
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaTable
    return { success: true, output: { table: mapTable(data) } }
  },

  outputs: {
    table: { type: 'object', description: 'Table details', properties: TABLE_PROPERTIES },
  },
}
