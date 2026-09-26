'use client'

import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import { noop } from '@sim/utils/helpers'
import type { ViewedSearchSource } from '@/lib/api/contracts/knowledge/search-history'
import { isKnowledgeSourceUrl } from '@/lib/knowledge/search/source-url'
import { handleExternalLinkClick } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-link'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useRecordSearchHistory } from '@/hooks/queries/search-history'

interface SourceHistoryContextValue {
  recordSource: (source: ViewedSearchSource) => void
  recordQuery: (query: string) => void
}
const SourceHistoryContext = createContext<SourceHistoryContextValue>({
  recordSource: noop,
  recordQuery: noop,
})

interface SourceHistoryProviderProps {
  organizationId?: string
  userId?: string
  children: ReactNode
}

/** Navigation is never delayed by history persistence; rendering and previews perform no writes. */
export function SourceHistoryProvider({
  organizationId,
  userId,
  children,
}: SourceHistoryProviderProps) {
  const { mutate } = useRecordSearchHistory(organizationId, userId)
  const recordSource = useCallback(
    (source: ViewedSearchSource) => {
      if (
        organizationId &&
        userId &&
        source.url.length <= 4096 &&
        isKnowledgeSourceUrl(source.url)
      ) {
        mutate({ kind: 'source', source })
      }
    },
    [organizationId, userId, mutate]
  )
  const recordQuery = useCallback(
    (query: string) => {
      if (organizationId && userId && query.trim() && query.trim().length <= 4000)
        mutate({ kind: 'query', query: query.trim() })
    },
    [organizationId, userId, mutate]
  )
  const value = useMemo(() => ({ recordSource, recordQuery }), [recordSource, recordQuery])
  return <SourceHistoryContext.Provider value={value}>{children}</SourceHistoryContext.Provider>
}

export function useSearchHistoryActions() {
  return useContext(SourceHistoryContext)
}

/** Native, keyboard and middle-click navigation share the same source-open boundary. */
export function useSourceNavigation(source: SourceTagData) {
  const { recordSource } = useSearchHistoryActions()
  return useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return
      recordSource({ url: source.url })
      handleExternalLinkClick(event, source.url)
    },
    [source.url, recordSource]
  )
}
