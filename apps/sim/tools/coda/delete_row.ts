import type { CodaRowMutationResponse, CodaRowParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  REQUEST_ID_OUTPUT,
  ROW_ID_PARAM,
  TABLE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaDeleteRowTool: ToolConfig<CodaRowParams, CodaRowMutationResponse> = {
  id: 'coda_delete_row',
  name: 'Coda Delete Row',
  description: 'Delete a row from a Coda table or view. Applied asynchronously.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM, tableId: TABLE_ID_PARAM, rowId: ROW_ID_PARAM },

  request: {
    url: (params) =>
      buildCodaUrl(
        codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'rows', [
          params.rowId,
          'rowId',
        ])
      ),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; id: string }
    return { success: true, output: { requestId: data.requestId, rowId: data.id } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    rowId: { type: 'string', description: 'ID of the deleted row' },
  },
}
