'use client'

import { omit } from '@sim/utils/object'
import { hashKey, keepPreviousData, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type QueryTableAnalyticsBody,
  queryTableAnalyticsContract,
} from '@/lib/api/contracts/table-analytics'

export const TABLE_ANALYTICS_STALE_TIME = 60_000
export const tableAnalyticsKeys = {
  all: ['table-analytics'] as const,
  queries: () => [...tableAnalyticsKeys.all, 'query'] as const,
  query: (tableId: string, body: QueryTableAnalyticsBody) =>
    [...tableAnalyticsKeys.queries(), tableId, body] as const,
}

interface UseTableAnalyticsProps {
  tableId: string
  body: QueryTableAnalyticsBody
}
export function useTableAnalytics({ tableId, body }: UseTableAnalyticsProps) {
  return useQuery({
    queryKey: tableAnalyticsKeys.query(tableId, body),
    queryFn: async ({ signal }) => {
      const result = await requestJson(queryTableAnalyticsContract, {
        params: { tableId },
        body,
        signal,
      })
      return { ...result, queryRange: { from: body.query.from, to: body.query.to } }
    },
    staleTime: TABLE_ANALYTICS_STALE_TIME,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey
      if (!previousKey) return undefined
      const [, , previousTableId, previousBody] = previousKey
      const sameSelection =
        previousTableId === tableId &&
        previousBody.workspaceId === body.workspaceId &&
        hashKey([omit(previousBody.query, ['from', 'to'])]) ===
          hashKey([omit(body.query, ['from', 'to'])])
      return sameSelection ? keepPreviousData(previousData) : undefined
    },
    retry: false,
  })
}
