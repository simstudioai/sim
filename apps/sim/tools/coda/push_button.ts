import type { CodaPushButtonParams, CodaPushButtonResponse } from '@/tools/coda/types'
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

export const codaPushButtonTool: ToolConfig<CodaPushButtonParams, CodaPushButtonResponse> = {
  id: 'coda_push_button',
  name: 'Coda Push Button',
  description:
    'Push a button column on a row of a Coda table, running its action. The button can perform any action in the doc.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    rowId: ROW_ID_PARAM,
    columnId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID or name of the button column (e.g., "c-tuVwxYz")',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(
        codaDocPath(
          params.docId,
          'tables',
          [params.tableId, 'tableId'],
          'rows',
          [params.rowId, 'rowId'],
          'buttons',
          [params.columnId, 'columnId']
        )
      ),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; rowId: string; columnId: string }
    return {
      success: true,
      output: { requestId: data.requestId, rowId: data.rowId, columnId: data.columnId },
    }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    rowId: { type: 'string', description: 'ID of the row containing the button' },
    columnId: { type: 'string', description: 'ID of the button column' },
  },
}
