import type {
  DatabricksGetStatementChunkParams,
  DatabricksGetStatementChunkResponse,
} from '@/tools/databricks/types'
import { STATEMENT_RESULT_OUTPUT_PROPERTIES } from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getStatementChunkTool: ToolConfig<
  DatabricksGetStatementChunkParams,
  DatabricksGetStatementChunkResponse
> = {
  id: 'databricks_get_statement_chunk',
  name: 'Databricks Get Statement Chunk',
  description:
    'Retrieve one chunk of an INLINE SQL result using nextChunkIndex from Execute SQL or Get Statement.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    statementId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL statement identifier',
    },
    chunkIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zero-based result chunk index',
    },
    warehouseId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SQL warehouse identifier, when required by the statement endpoint',
    },
  },
  request: {
    url: (params) => {
      const origin = databricksUrl(params.host, '')
      if (!Number.isInteger(params.chunkIndex) || params.chunkIndex < 0)
        throw new Error('chunkIndex must be a nonnegative integer')
      const url = new URL(
        `${origin}/api/2.0/sql/statements/${safeUrlPathSegment(params.statementId, 'statementId')}/result/chunks/${safeUrlPathSegment(String(params.chunkIndex), 'chunkIndex')}`
      )
      const warehouseId = optionalDatabricksString(params.warehouseId)
      if (warehouseId) url.searchParams.set('warehouse_id', warehouseId)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to retrieve SQL chunk'))
    const data = await response.json()
    if (data.external_links?.length)
      throw new Error(
        'Get Statement Chunk supports INLINE results; execute the query with Execute SQL'
      )
    return {
      success: true,
      output: {
        data: data.data_array ?? [],
        chunkIndex: data.chunk_index ?? null,
        rowOffset: data.row_offset ?? null,
        rowCount: data.row_count ?? null,
        nextChunkIndex: data.next_chunk_index ?? null,
        nextChunkInternalLink: data.next_chunk_internal_link ?? null,
      },
    }
  },
  outputs: {
    data: {
      type: 'array',
      description:
        'Result rows as a 2D array; each non-null value is a string and null values stay null',
      items: { type: 'array', description: 'A single row of column values' },
    },
    chunkIndex: STATEMENT_RESULT_OUTPUT_PROPERTIES.chunkIndex,
    rowOffset: STATEMENT_RESULT_OUTPUT_PROPERTIES.rowOffset,
    rowCount: STATEMENT_RESULT_OUTPUT_PROPERTIES.rowCount,
    nextChunkIndex: STATEMENT_RESULT_OUTPUT_PROPERTIES.nextChunkIndex,
    nextChunkInternalLink: STATEMENT_RESULT_OUTPUT_PROPERTIES.nextChunkInternalLink,
  },
}
