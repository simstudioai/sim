'use client'

import { useMemo, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/client'
import { type ResourceScope, resourceScopeKey } from '@/lib/core/resource-scope'
import { BrowserStorage } from '@/lib/core/utils/browser-storage'
import { groupResultsByDocument, toSource } from '@/lib/knowledge/search/results'
import {
  searchFilterParsers,
  searchFiltersFromParams,
  UPDATED_WINDOWS,
} from '@/lib/mothership/chat/search-params'
import type { SearchResource } from '@/lib/mothership/generated/resources'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/lib/organizations/search-params'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'
import {
  useClearSearchHistory,
  useRecordSearchHistory,
  useSearchHistory,
} from '@/hooks/queries/search-history'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import type { PlatformResource } from '@/platform/app/(shell)/_components/chat/model'
import type {
  SearchResultsData,
  SearchSourceRow,
} from '@/platform/app/(shell)/_components/search/model'
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { useSummaryQueue } from '@/platform/lib/data/search-summary'
import { toast } from '@/platform/shared/toast'

const NO_FILTERS: WorkspaceSearchFilters = {}
/** A tab without a retrieval address runs nothing: an empty query never enables the read. */
const NO_SCOPE: ResourceScope = { kind: 'organization', organizationId: '' }
const SEARCH_MODE_STORAGE = 'organization-search-mode'

interface SearchReadOptions {
  scope: ResourceScope
  query: string
  filters: WorkspaceSearchFilters
  topK?: number
  nativeQueries?: SearchResource['nativeQueries']
  reuseFreshResult?: boolean
  awaitingRange?: boolean
  onRecordSource?: (row: SearchSourceRow) => void
  onSummarize?: (row: SearchSourceRow) => void
}

/** The legacy results' reading of one search: the same query, grouping and notices. */
function useSearchResults({
  scope,
  query,
  filters,
  topK,
  nativeQueries,
  reuseFreshResult,
  awaitingRange = false,
  onRecordSource,
  onSummarize,
}: SearchReadOptions): SearchResultsData {
  const organization = useOrganization()
  const { data, isPending, isFetching, isError, refetch } = useWorkspaceKnowledgeSearch(
    scope,
    awaitingRange ? '' : query,
    filters,
    topK ?? 20,
    { nativeQueries, reuseFreshResult }
  )
  const documents = useMemo(() => groupResultsByDocument(data?.results ?? []), [data?.results])
  const rows = useMemo(
    () =>
      documents.map((result) => {
        const source = toSource(result, query, scope)
        return {
          id: result.documentId,
          url: source.url,
          title: source.title ?? source.siteName ?? source.url,
          meta: source.siteName,
          snippet: source.snippet,
        }
      }),
    [documents, query, scope]
  )
  const accounts = data?.live?.accounts ?? []
  const status: SearchResultsData['status'] = awaitingRange
    ? 'needs-range'
    : isError
      ? 'error'
      : isFetching
        ? isPending
          ? 'searching'
          : 'updating'
        : 'ready'
  return {
    status,
    providers: accounts.map((account) => account.provider),
    retry: () => void refetch(),
    empty: status === 'ready' && data?.retrieval.status === 'complete' && documents.length === 0,
    noApps:
      !isFetching && data?.live && accounts.length === 0
        ? { href: legacyRoutes(organization).settingsSection('integrations') }
        : undefined,
    someAppsUnavailable: accounts.some((account) =>
      ['unavailable', 'timeout', 'rate_limited', 'reconnect'].includes(account.status)
    ),
    partial: !data?.live && data?.retrieval.status === 'partial',
    rows,
    onCopyLink: (row) => {
      navigator.clipboard.writeText(row.url).catch(() => toast.error('Unable to copy link'))
    },
    onOpen: (row) => onRecordSource?.(row),
    // A row's document stops being what it read as while its results may still change.
    onSummarize: isFetching ? undefined : onSummarize,
  }
}

/** Everything the Search route reads: the URL, the query, the viewer's history and the mode. */
export function useSearchSurface(chatId: string | undefined) {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const assistantAvailable = organization.mothershipAvailable
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''
  const queryClient = useQueryClient()
  const [params, setParams] = useQueryStates(
    { ...organizationSearchParsers, ...searchFilterParsers },
    organizationSearchUrlKeys
  )
  const { q: query, mode: urlMode, source, updated, from, to } = params
  const storageKey = `${SEARCH_MODE_STORAGE}:${userId}:${organizationId}`
  const remembered = useMemo(
    () => (userId ? BrowserStorage.getItem<'search' | 'assistant' | null>(storageKey, null) : null),
    [userId, storageKey]
  )
  const hasSearchParams = Boolean(query || source || updated !== 'any')
  const mode: 'search' | 'assistant' = !assistantAvailable
    ? 'search'
    : (urlMode ?? (chatId ? 'assistant' : hasSearchParams ? 'search' : (remembered ?? 'search')))
  const [assistantStarted, setAssistantStarted] = useState(mode === 'assistant')
  if (mode === 'assistant' && !assistantStarted) setAssistantStarted(true)
  const setMode = (next: string) => {
    const value = next === 'assistant' ? 'assistant' : 'search'
    if (userId) BrowserStorage.setItem(storageKey, value)
    void setParams({ mode: value }, { history: 'push' })
  }
  const [searchedAt] = useState(() => Date.now())
  const filters = searchFiltersFromParams({ source, updated, from, to }, searchedAt)
  const scope = useMemo<ResourceScope>(
    () => ({ kind: 'organization', organizationId }),
    [organizationId]
  )
  const showingSearch = mode === 'search'
  const history = useSearchHistory(showingSearch ? organizationId : undefined, userId)
  const clearHistory = useClearSearchHistory(organizationId, userId)
  const record = useRecordSearchHistory(organizationId, userId)
  const awaitingRange = updated === 'custom' && !(from && to)
  const summaries = useSummaryQueue()
  const results = useSearchResults({
    scope,
    // Hidden behind Assistant, a query in the URL must not search every connected app.
    query: showingSearch ? query : '',
    filters: showingSearch ? filters : NO_FILTERS,
    awaitingRange,
    onRecordSource: (row) =>
      record.mutate({
        kind: 'source',
        source: { url: row.url, title: row.title, siteName: row.meta },
      }),
    onSummarize: assistantAvailable
      ? (row) => {
          summaries.enqueue(`Summarize "${row.title}"`, { ...filters, documentIds: [row.id] })
          setMode('assistant')
        }
      : undefined,
  })
  const fetching =
    useIsFetching({
      queryKey: knowledgeKeys.searchQuery(resourceScopeKey(scope), query.trim(), userId),
    }) > 0
  const sourceTypes = [...new Set([...results.providers, ...(source ? [source] : [])])]

  return {
    organizationName: organization.organization.name,
    mode,
    setMode,
    assistantAvailable,
    assistantStarted,
    /** The next summary for the conversation, held until Assistant is what the viewer is reading. */
    pendingSummary: mode === 'assistant' ? summaries.pending : undefined,
    consumeSummary: summaries.consume,
    query,
    filtered: Boolean(source) || updated !== 'any',
    searching: fetching,
    submit: (next: string) => {
      const value = next.trim()
      if (!value) return
      if (value === query) {
        void queryClient.invalidateQueries({
          queryKey: knowledgeKeys.searchQuery(resourceScopeKey(scope), value, userId),
        })
        return
      }
      record.mutate({ kind: 'query', query: value })
      void setParams({ q: value })
    },
    stop: () => {
      void queryClient.cancelQueries({
        queryKey: knowledgeKeys.searchQuery(resourceScopeKey(scope), query.trim(), userId),
      })
    },
    clear: () => {
      summaries.clear()
      void setParams({ q: '', source: null, updated: 'any', from: null, to: null })
    },
    results: {
      ...results,
      filters: {
        source: {
          value: source ?? '',
          options: [
            { id: '', label: 'All sources' },
            ...sourceTypes.map((type) => ({
              id: type,
              label: type === 'upload' ? 'Uploads' : connectorDisplayName(type),
            })),
          ],
          onChange: (id: string) => void setParams({ source: id || null }),
        },
        updated: {
          value: updated,
          options: UPDATED_WINDOWS.map((window) => ({ id: window.id, label: window.label })),
          onChange: (id: string) => {
            const window = UPDATED_WINDOWS.find((entry) => entry.id === id)
            if (window)
              void setParams(
                window.id === 'custom'
                  ? { updated: window.id }
                  : { updated: window.id, from: null, to: null }
              )
          },
        },
        range:
          updated === 'custom'
            ? {
                from: from?.toISOString().slice(0, 10),
                to: to?.toISOString().slice(0, 10),
                onChange: (start: string, end: string) =>
                  void setParams({ from: new Date(start), to: new Date(end) }),
              }
            : undefined,
      },
    },
    history: {
      status: history.isError
        ? ('error' as const)
        : history.isPending
          ? ('loading' as const)
          : ('ready' as const),
      retry: () => void history.refetch(),
      sources: (history.data?.sources ?? []).slice(0, 5).map((item) => ({
        id: item.url,
        label: item.title ?? item.siteName ?? item.url,
      })),
      queries: (history.data?.queries ?? []).slice(0, 5).map((item) => ({
        id: item.query,
        label: item.query,
      })),
      openSource: (url: string) => window.open(url, '_blank', 'noopener,noreferrer'),
      clear: () => clearHistory.mutate(),
    },
  }
}

/** A Search tab in a chat panel: its stored query, re-run under the current reader. */
export function useSearchTabResults(resource: PlatformResource): SearchResultsData {
  const search = resource.search
  return useSearchResults({
    scope: search?.scope ?? NO_SCOPE,
    query: search?.query ?? '',
    filters: search?.filters ?? NO_FILTERS,
    topK: search?.topK,
    nativeQueries: search?.nativeQueries,
    reuseFreshResult: true,
  })
}

/** Home's Search entry: a submitted query, recorded as Search's own field records one. */
export function useStartSearch(): ((query: string) => void) | null {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const { data: session } = useSession()
  const record = useRecordSearchHistory(organizationId, session?.user?.id)
  const router = useRouter()
  if (!organization.searchAccess.memberScoped) return null
  return (query) => {
    record.mutate({ kind: 'query', query })
    router.push(`/search?${new URLSearchParams({ q: query })}`)
  }
}
