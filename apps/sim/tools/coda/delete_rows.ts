import type { CodaDeleteRowsParams, CodaDeleteRowsResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  parseStringList,
  REQUEST_ID_OUTPUT,
  TABLE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaDeleteRowsTool: ToolConfig<CodaDeleteRowsParams, CodaDeleteRowsResponse> = {
  id: 'coda_delete_rows',
  name: 'Coda Delete Rows',
  description: 'Delete multiple rows from a Coda table or view by ID. Applied asynchronously.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    rowIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Row IDs to delete, as an array or comma-separated list (e.g., ["i-bCdeFgh", "i-CdEfgHi"])',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'rows')),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const rowIds = parseStringList(params.rowIds, 'rowIds')
      if (rowIds.length === 0) throw new Error('rowIds must contain at least one row ID')
      return { rowIds }
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; rowIds?: string[] }
    return { success: true, output: { requestId: data.requestId, rowIds: data.rowIds ?? [] } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    rowIds: {
      type: 'array',
      description: 'IDs of the rows queued for deletion',
      items: { type: 'string', description: 'Row ID' },
    },
  },
}
