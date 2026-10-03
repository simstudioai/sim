import type { CodaGetRowParams, CodaRowResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  mapRow,
  type RawCodaRow,
  ROW_ID_PARAM,
  ROW_PROPERTIES,
  TABLE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetRowTool: ToolConfig<CodaGetRowParams, CodaRowResponse> = {
  id: 'coda_get_row',
  name: 'Coda Get Row',
  description: 'Get a single row from a Coda table, including all of its cell values',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    rowId: ROW_ID_PARAM,
    useColumnNames: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key cell values by column name instead of column ID',
    },
    valueFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cell value format: "simple" (default), "simpleWithArrays", or "rich"',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(
        codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'rows', [
          params.rowId,
          'rowId',
        ]),
        { useColumnNames: params.useColumnNames, valueFormat: params.valueFormat }
      ),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaRow
    return { success: true, output: { row: mapRow(data) } }
  },

  outputs: {
    row: { type: 'object', description: 'Row details and values', properties: ROW_PROPERTIES },
  },
}
