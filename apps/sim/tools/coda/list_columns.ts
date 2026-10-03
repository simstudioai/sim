import type { CodaListColumnsParams, CodaListColumnsResponse } from '@/tools/coda/types'
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
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  type RawCodaColumn,
  TABLE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListColumnsTool: ToolConfig<CodaListColumnsParams, CodaListColumnsResponse> = {
  id: 'coda_list_columns',
  name: 'Coda List Columns',
  description:
    'List the columns of a Coda table with their IDs, formats, and formulas. Use column IDs when reading and writing rows.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    visibleOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return visible columns (applies to base tables, not views)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of columns to return (1-100, default 25)',
    },
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'columns'), {
        visibleOnly: params.visibleOnly,
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { items?: RawCodaColumn[]; nextPageToken?: string }
    return {
      success: true,
      output: {
        columns: (data.items ?? []).map(mapColumn),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    columns: {
      type: 'array',
      description: 'Columns in the table',
      items: { type: 'object', properties: COLUMN_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
