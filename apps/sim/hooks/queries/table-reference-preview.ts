'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { type GetTableRowResponse, getTableRowContract } from '@/lib/api/contracts/tables'
import { collectColumnReferencedTableIds } from '@/lib/table/column-types'
import { getTableDetailQueryOptions, getTableNamesQueryOptions } from '@/hooks/queries/tables'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

/**
 * Split out of `@/hooks/queries/tables` on purpose: this is the only table query that reads the
 * column-type registry, and that barrel pulls all eleven type modules. The workspace sidebar
 * imports `tables` for `useTablesList`, so leaving this here put the whole registry in the module
 * graph of every route under `workspace/` — 13 modules that no sidebar render ever touches, and
 * enough to trip the page-weight ratchet in `check-tool-registry-boundary`.
 */

export const TABLE_REFERENCE_PREVIEW_STALE_TIME = Number.POSITIVE_INFINITY
const TABLE_REFERENCE_PREVIEW_GC_TIME = 0

async function fetchTableRow(
  workspaceId: string,
  tableId: string,
  rowId: string,
  signal?: AbortSignal
): Promise<GetTableRowResponse['data']['row'] | null> {
  try {
    const response = await requestJson(getTableRowContract, {
      params: { tableId, rowId },
      query: { workspaceId },
      signal,
    })
    return response.data.row
  } catch (error) {
    if (isApiClientError(error) && error.status === 404) return null
    throw error
  }
}

interface ReferenceRowPreviewParams {
  workspaceId: string | undefined
  tableId: string | undefined
  rowId: string | undefined
  sourceRowId?: string
  sourceColumnKey?: string
}

/** Loads a referenced table and row together for an expanded source cell. */
export function useReferenceRowPreview({
  workspaceId,
  tableId,
  rowId,
  sourceRowId,
  sourceColumnKey,
}: ReferenceRowPreviewParams) {
  const queryClient = useQueryClient()
  // rq-lint-allow: tableId is globally unique; workspaceId is only an authz scope on the fetch and cannot collide across workspaces
  return useQuery({
    queryKey: tableKeys.referencePreview(tableId ?? '', rowId ?? '', sourceRowId, sourceColumnKey),
    queryFn: async ({ signal }) => {
      const [table, row] = await Promise.all([
        queryClient
          .fetchQuery({
            ...getTableDetailQueryOptions(workspaceId as string, tableId as string),
            retry: (failureCount, error) =>
              !(isApiClientError(error) && error.status === 404) && failureCount < 1,
          })
          .catch((error: unknown) => {
            if (isApiClientError(error) && error.status === 404) return null
            throw error
          }),
        fetchTableRow(workspaceId as string, tableId as string, rowId as string, signal),
      ])
      if (!table) return { table: null, row: null, referenceTables: [] }
      const referenceTableIds = collectColumnReferencedTableIds(table.schema.columns)
      const referenceTables =
        referenceTableIds.length === 0
          ? []
          : await queryClient.fetchQuery(
              getTableNamesQueryOptions(workspaceId as string, referenceTableIds)
            )
      return { table, row, referenceTables }
    },
    enabled: Boolean(workspaceId && tableId && rowId && sourceRowId && sourceColumnKey),
    /**
     * `refetchOnMount: 'always'` is the load-bearing setting — every opening re-reads the
     * referenced row — and `gcTime: 0` drops the entry once the preview closes. The infinite
     * `staleTime` only keeps an open preview from refetching underneath the reader.
     */
    staleTime: TABLE_REFERENCE_PREVIEW_STALE_TIME,
    gcTime: TABLE_REFERENCE_PREVIEW_GC_TIME,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
