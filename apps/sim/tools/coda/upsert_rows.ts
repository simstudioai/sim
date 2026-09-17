import type { CodaUpsertRowsParams, CodaUpsertRowsResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  parseJsonInput,
  parseStringList,
  REQUEST_ID_OUTPUT,
  TABLE_ID_PARAM,
  toCodaCells,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaUpsertRowsTool: ToolConfig<CodaUpsertRowsParams, CodaUpsertRowsResponse> = {
  id: 'coda_upsert_rows',
  name: 'Coda Insert or Upsert Rows',
  description:
    'Insert rows into a Coda base table, or update matching rows when key columns are given. Only works on base tables, not views. Applied asynchronously.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    tableId: TABLE_ID_PARAM,
    rows: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of rows. Each row maps column IDs (or names) to values, e.g., [{"c-tuVwxYz": "Apple", "c-bCdeFgh": 12}], or uses Coda cells [{"cells": [{"column": "c-tuVwxYz", "value": "Apple"}]}]',
    },
    keyColumns: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Column IDs (or names) to match existing rows on, as an array or comma-separated list. Matching rows are updated instead of inserted.',
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
      buildCodaUrl(codaDocPath(params.docId, 'tables', [params.tableId, 'tableId'], 'rows'), {
        disableParsing: params.disableParsing,
      }),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const parsed = parseJsonInput(params.rows, 'rows')
      const rows = Array.isArray(parsed) ? parsed : parsed === undefined ? [] : [parsed]
      if (rows.length === 0) throw new Error('rows must contain at least one row')
      const keyColumns = parseStringList(params.keyColumns, 'keyColumns')
      return {
        rows: rows.map((row, index) => ({ cells: toCodaCells(row, `rows[${index}]`) })),
        ...(keyColumns.length > 0 ? { keyColumns } : {}),
      }
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; addedRowIds?: string[] }
    return {
      success: true,
      output: { requestId: data.requestId, addedRowIds: data.addedRowIds ?? [] },
    }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    addedRowIds: {
      type: 'array',
      description: 'IDs of rows that will be added (only returned when no key columns are set)',
      items: { type: 'string', description: 'Row ID' },
    },
  },
}
