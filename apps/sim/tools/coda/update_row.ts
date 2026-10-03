import type { CodaRowMutationResponse, CodaUpdateRowParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  parseJsonInput,
  REQUEST_ID_OUTPUT,
  ROW_ID_PARAM,
  TABLE_ID_PARAM,
  toCodaCells,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaUpdateRowTool: ToolConfig<CodaUpdateRowParams, CodaRowMutationResponse> = {
  id: 'coda_update_row',
  name: 'Coda Update Row',
  description: 'Update cell values in a row of a Coda table. Applied asynchronously.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    rowId: ROW_ID_PARAM,
    cells: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Object mapping column IDs (or names) to new values, e.g., {"c-tuVwxYz": "Done"}, or Coda cells [{"column": "c-tuVwxYz", "value": "Done"}]',
    },
    disableParsing: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Store values exactly as given without parsing them',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(
        codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'rows', [
          params.rowId,
          'rowId',
        ]),
        { disableParsing: params.disableParsing }
      ),
    method: 'PUT',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const cells = toCodaCells(parseJsonInput(params.cells, 'cells'), 'cells')
      if (cells.length === 0) throw new Error('cells must contain at least one column value')
      return { row: { cells } }
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; id: string }
    return { success: true, output: { requestId: data.requestId, rowId: data.id } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    rowId: { type: 'string', description: 'ID of the updated row' },
  },
}
