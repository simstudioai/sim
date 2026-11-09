'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/client'
import { type ResourceScope, resourceScopeKey } from '@/lib/core/resource-scope'
import { groupResultsByDocument, toSource } from '@/lib/knowledge/search/results'
import {
  searchFilterParsers,
  searchFiltersFromParams,
  UPDATED_WINDOWS,
} from '@/lib/mothership/chat/search-params'
import type { SearchResource } from '@/lib/mothership/generated/resources'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
  readRememberedSearchMode,
  rememberedSearchModeCookie,
  searchModeCookieName,
  searchModeInUrl,
} from '@/lib/organizations/search-params'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import type { PlatformResource } from '@/app/(product)/_components/chat/model'
import type { SearchResultsData } from '@/app/(product)/_components/search/model'
import { useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'
import {
  useClearSearchHistory,
  useRecordSearchHistory,
  useSearchHistory,
} from '@/hooks/queries/search-history'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { useClientStored } from '@/hooks/use-client-stored'
import { useHydrated } from '@/hooks/use-hydrated'
import { useOrganization } from '@/platform/lib/data/organization'
import { useSummaryQueue } from '@/platform/lib/data/search-summary'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

type SearchSourceRow = SearchResultsData['rows'][number]

const NO_FILTERS: WorkspaceSearchFilters = {}
/** A tab without a retrieval address runs nothing: an empty query never enables the read. */
const NO_SCOPE: ResourceScope = { kind: 'organization', organizationId: '' }

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
        ? { href: organizationRoutes(organization.organization.id).integrations }
        : undefined,
    someAppsUnavailable: accounts.some((account) =>
      ['unavailable', 'timeout', 'rate_limited', 'reconnect'].includes(account.status)
    ),
    partial: !data?.live && data?.retrieval.status === 'partial',
    rows,
    onOpen: (row) => onRecordSource?.(row),
    // A row's document stops being what it read as while its results may still change.
    onSummarize: isFetching ? undefined : onSummarize,
  }
}

/** The keys Search keeps unsent text under: the Assistant's question, and the field's draft per query. */
function searchDraftKeys(userId: string, organizationId: string) {
  const prefix = `${userId}:organization:${organizationId}`
  const latest = `${prefix}:search`
  return {
    latest,
    assistant: `${prefix}:search-assistant`,
    query: (query: string) => `${latest}:query:${encodeURIComponent(query)}`,
  }
}

function readSearchModeCookie(organizationId: string) {
  const prefix = `${searchModeCookieName(organizationId)}=`
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length)
}

/** Everything the Search route reads: the URL, the query, the viewer's history and the mode. */
export function useSearchSurface(chatId: string | undefined) {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const assistantAvailable = organization.mothershipAvailable
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''
  const queryClient = useQueryClient()
  const router = useRouter()
  const routes = organizationRoutes(organizationId)
  const pathname = usePathname()
  const hasConversation = Boolean(chatId) || pathname.startsWith(`${routes.search}/chat/`)
  const [params, setParams] = useQueryStates(
    { ...organizationSearchParsers, ...searchFilterParsers },
    organizationSearchUrlKeys
  )
  const { q: query, mode: urlMode, source, updated, from, to } = params
  // The browser's cookie; server markup and hydration paint without it.
  const remembered = useClientStored(
    () => readRememberedSearchMode(readSearchModeCookie(organizationId), userId),
    null
  )
  const routeMode =
    !urlMode && hasConversation
      ? 'assistant'
      : searchModeInUrl({ mode: urlMode, q: query, source, updated })
  const mode: 'search' | 'assistant' = !assistantAvailable
    ? 'search'
    : (routeMode ?? remembered ?? 'search')
  // The server pins a bare URL to this mode (`pinnedSearchHref`); the client never writes it.
  useEffect(() => {
    if (!assistantAvailable || !userId || !routeMode) return
    document.cookie = rememberedSearchModeCookie(organizationId, userId, routeMode)
  }, [assistantAvailable, userId, routeMode, organizationId])
  const [assistantStarted, setAssistantStarted] = useState(mode === 'assistant')
  if (mode === 'assistant' && !assistantStarted) setAssistantStarted(true)
  const setMode = (next: string) => {
    void setParams({ mode: next === 'assistant' ? 'assistant' : 'search' }, { history: 'push' })
  }
  const [conversationInstance, setConversationInstance] = useState(0)
  const [startingNew, startNewTransition] = useTransition()
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
    newLabel: mode === 'assistant' ? 'New chat' : 'New search',
    canStartNew: hasConversation || (mode === 'search' && Boolean(query.trim())),
    startingNew,
    /** A fresh conversation or search in the current mode, dropping its unsent text. */
    startNew: () => {
      summaries.clear()
      const { clearDraft } = useMothershipDraftsStore.getState()
      if (userId) {
        const drafts = searchDraftKeys(userId, organizationId)
        if (mode === 'assistant') clearDraft(drafts.assistant)
        else {
          clearDraft(drafts.latest)
          clearDraft(drafts.query(''))
        }
      }
      startNewTransition(() => {
        setConversationInstance((current) => current + 1)
        router.push(assistantAvailable ? `${routes.search}?mode=${mode}` : routes.search, {
          scroll: false,
        })
      })
    },
    conversationInstance,
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

interface SearchFieldOptions {
  /** The committed query the field opened on; its edits are kept apart from other queries'. */
  query: string
  searching: boolean
  onSubmit: (value: string) => void
  onStop: () => void
}

/**
 * Search's field: an editable draft kept per committed query, so a reload, Back to an earlier query
 * or a return to the same one restores what was typed. What is typed before the session is known
 * stays in the field until the next edit stores it. The field takes focus once hydrated.
 */
export function useSearchField({ query, searching, onSubmit, onStop }: SearchFieldOptions) {
  const organization = useOrganization()
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''
  const hydrated = useHydrated()
  const inputRef = useRef<HTMLInputElement>(null)
  const drafts = searchDraftKeys(userId, organization.organization.id)
  const latest = useMothershipDraftsStore((state) => state.drafts[drafts.latest])
  const owner = query || latest?.searchQuery || ''
  const draftKey = drafts.query(owner)
  const saved = useMothershipDraftsStore((state) => state.drafts[draftKey])
  const stored = saved?.text ?? (latest?.searchQuery === owner ? latest.text : query)
  const [unstored, setUnstored] = useState<string | null>(null)
  // Server markup knows only the URL, so the saved draft appears once the page is interactive.
  const value = unstored ?? (hydrated && userId ? stored : query)
  useEffect(() => {
    if (hydrated) inputRef.current?.focus()
  }, [hydrated])
  const setValue = (text: string) => {
    if (!userId) {
      setUnstored(text)
      return
    }
    setUnstored(null)
    const { setDraft } = useMothershipDraftsStore.getState()
    const payload = { text, searchQuery: owner }
    setDraft(draftKey, payload)
    setDraft(drafts.latest, payload)
  }
  const submit = (text = value) => {
    const next = text.trim()
    if (!next || (searching && next === query.trim())) return
    const { clearDraft } = useMothershipDraftsStore.getState()
    if (next === value.trim()) {
      clearDraft(draftKey)
      if (latest?.searchQuery === owner) clearDraft(drafts.latest)
    }
    clearDraft(drafts.query(next))
    setUnstored(null)
    onSubmit(next)
  }
  return {
    inputRef,
    value,
    setValue,
    submit,
    canSubmit: hydrated && value.trim().length > 0,
    /** The field's action: Stop while this query runs, otherwise Search. */
    submitOrStop: () => (searching ? onStop() : submit()),
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
