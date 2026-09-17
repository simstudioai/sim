import type { CodaListRowsParams, CodaListRowsResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  LIMIT_PARAM,
  mapRow,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  type RawCodaRow,
  ROW_PROPERTIES,
  TABLE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListRowsTool: ToolConfig<CodaListRowsParams, CodaListRowsResponse> = {
  id: 'coda_list_rows',
  name: 'Coda List Rows',
  description:
    'List rows in a Coda table or view, optionally filtered by a column value, sorted, or limited to rows changed since a sync token',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter as <column_id_or_name>:<JSON value>. Quote column names and string values, e.g., c-tuVwxYz:"Apple" or "Status":"Done"',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order: "createdAt" (default), "updatedAt", or "natural" (view order; implies visibleOnly)',
    },
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
    visibleOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return visible rows and columns',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'nextSyncToken from a previous call, to return only rows changed since then',
    },
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'rows'), {
        query: optionalTrimmed(params.query),
        sortBy: params.sortBy,
        useColumnNames: params.useColumnNames,
        valueFormat: params.valueFormat,
        visibleOnly: params.visibleOnly,
        syncToken: optionalTrimmed(params.syncToken),
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      items?: RawCodaRow[]
      nextPageToken?: string
      nextSyncToken?: string
    }
    return {
      success: true,
      output: {
        rows: (data.items ?? []).map(mapRow),
        nextPageToken: data.nextPageToken || null,
        nextSyncToken: data.nextSyncToken ?? null,
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Rows in the table',
      items: { type: 'object', properties: ROW_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
    nextSyncToken: {
      type: 'string',
      description: 'Token to pass as syncToken later to fetch only rows changed after this call',
      optional: true,
    },
  },
}
