'use client'

/**
 * React Query hooks for a publicly shared interface's module data.
 *
 * Every call here is addressed by `(token, moduleId)` and carries no workspace,
 * table, file, or workflow identifier — the server derives the resource from the
 * interface's stored layout. There is deliberately no "list files", "list
 * tables", or "get interface" hook: everything a visitor can reach is either
 * resolved server-side into the page's props or fetched through one of these two
 * module-scoped calls.
 */

import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { SubmitInterfaceFormValues } from '@/lib/api/contracts/interfaces'
import {
  getPublicInterfaceTableRowsContract,
  type PublicInterfaceTableRowsResponse,
  submitPublicInterfaceFormContract,
} from '@/lib/api/contracts/public-interfaces'
import { countLoadedTableRows } from '@/hooks/queries/utils/table-rows-pagination'

export const publicInterfaceKeys = {
  all: ['publicInterface'] as const,
  tableRows: () => [...publicInterfaceKeys.all, 'tableRows'] as const,
  /** Page size scopes the fetch, so it scopes the cache entry too. */
  moduleTableRows: (token: string, moduleId: string, pageSize: number) =>
    [...publicInterfaceKeys.tableRows(), token, moduleId, pageSize] as const,
}

/** Matches the in-workspace rows query so a shared table feels no staler than an open one. */
export const PUBLIC_INTERFACE_TABLE_ROWS_STALE_TIME = 30 * 1000

interface FetchPublicInterfaceTableRowsArgs {
  token: string
  moduleId: string
  limit: number
  offset: number
  includeTotal: boolean
  signal?: AbortSignal
}

async function fetchPublicInterfaceTableRows({
  token,
  moduleId,
  limit,
  offset,
  includeTotal,
  signal,
}: FetchPublicInterfaceTableRowsArgs): Promise<PublicInterfaceTableRowsResponse> {
  return requestJson(getPublicInterfaceTableRowsContract, {
    params: { token, moduleId },
    query: { limit, offset, includeTotal },
    signal,
  })
}

export interface PublicInterfaceTableRowsParams {
  token: string
  moduleId: string
  pageSize: number
  enabled?: boolean
}

/**
 * Pages a shared table module's rows.
 *
 * Continuation is driven by the server's `hasMore` rather than derived from the
 * page length or the row count: only the server knows where the public row
 * ceiling cuts the drain off, so a client-side rule would either stop early or
 * keep asking past the cap. The next offset is the number of rows actually
 * loaded — not pages × pageSize — so a short page resumes without a gap.
 *
 * Page 0 pays for the server-side `COUNT(*)`; later pages skip it, and the
 * module reads the total off the first page.
 */
export function usePublicInterfaceTableRows({
  token,
  moduleId,
  pageSize,
  enabled = true,
}: PublicInterfaceTableRowsParams) {
  return useInfiniteQuery({
    queryKey: publicInterfaceKeys.moduleTableRows(token, moduleId, pageSize),
    queryFn: ({ pageParam, signal }) =>
      fetchPublicInterfaceTableRows({
        token,
        moduleId,
        limit: pageSize,
        offset: pageParam,
        includeTotal: pageParam === 0,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? countLoadedTableRows(allPages) : undefined,
    enabled: Boolean(token && moduleId) && enabled,
    staleTime: PUBLIC_INTERFACE_TABLE_ROWS_STALE_TIME,
  })
}

export interface SubmitPublicInterfaceFormVariables {
  moduleId: string
  values: SubmitInterfaceFormValues
}

/**
 * Submits a shared form module's values.
 *
 * No toast on failure, unlike the in-workspace mutation: per-field errors render
 * inline from the 400's `details`, and everything else renders in the form's own
 * footer — a public page should not narrate a workspace's run failures in a
 * corner notification.
 */
export function useSubmitPublicInterfaceForm(token: string) {
  return useMutation({
    mutationFn: ({ moduleId, values }: SubmitPublicInterfaceFormVariables) =>
      requestJson(submitPublicInterfaceFormContract, {
        params: { token, moduleId },
        body: { values },
      }),
  })
}
