import type { CodaColumnResponse, CodaGetColumnParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  COLUMN_PROPERTIES,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  mapColumn,
  type RawCodaColumn,
  TABLE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetColumnTool: ToolConfig<CodaGetColumnParams, CodaColumnResponse> = {
  id: 'coda_get_column',
  name: 'Coda Get Column',
  description: 'Get details about a column in a Coda table, including its full format settings',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    columnId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID or name of the column (IDs are recommended, e.g., "c-tuVwxYz")',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(
        codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'columns', [
          params.columnId,
          'columnId',
        ])
      ),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaColumn
    return { success: true, output: { column: mapColumn(data) } }
  },

  outputs: {
    column: { type: 'object', description: 'Column details', properties: COLUMN_PROPERTIES },
  },
}
