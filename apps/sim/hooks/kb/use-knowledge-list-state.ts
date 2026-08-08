'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueryState, useQueryStates } from 'nuqs'
import type { SortConfig } from '@/components/resource'
import type { KnowledgeEnabledFilter, TagFilterEntry } from '@/components/resources/knowledge-view'
import {
  addConnectorParam,
  documentFiltersParsers,
  documentFiltersUrlKeys,
  KB_SORT_COLUMNS,
  kbDocumentSortParams,
  pageParam,
  pageUrlKeys,
} from '@/lib/knowledge/detail-search-params'
import { SEARCH_DEBOUNCE_MS, type SortDirection } from '@/lib/url-state'
import type { DocumentTagFilter } from '@/hooks/queries/kb/knowledge'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useUrlSort } from '@/hooks/use-url-sort'
import { hostOwnsUrl, type ResourceHost } from '@/resources'

const DEFAULT_SORT = kbDocumentSortParams.default

export interface KnowledgeListState {
  searchQuery: string
  setSearchQuery: (value: string) => void
  /** Debounced copy that feeds the document query, so typing does not refetch per keystroke. */
  debouncedSearchQuery: string
  /** Raw value drives the input; matching/highlighting always sees it trimmed. */
  highlightQuery: string
  enabledFilter: KnowledgeEnabledFilter
  setEnabledFilter: (value: KnowledgeEnabledFilter) => void
  tagFilterEntries: TagFilterEntry[]
  setTagFilterEntries: (entries: TagFilterEntry[]) => void
  /** The subset of `tagFilterEntries` complete enough to send to the API. */
  activeTagFilters: DocumentTagFilter[]
  currentPage: number
  setCurrentPage: (page: number) => void
  sortColumn: string
  sortDirection: SortDirection
  sort: Omit<SortConfig, 'options'>
  /** Non-null while the add-connector modal is open; the value seeds its connector type. */
  addConnectorType: string | null
  setAddConnectorType: (value: string | null) => void
}

/**
 * Document-list view-state for one knowledge base, stored where the host allows.
 *
 * A host that owns the URL (`hostOwnsUrl`) keeps search, status, sort and page
 * in query params, so the list is shareable and survives reload. An embedded
 * host does not: it holds the identical state locally, because writing
 * unnamespaced `?q` / `?enabled` / `?sort` / `?dir` / `?page` / `?addConnector`
 * keys would pollute the address bar of whatever page is hosting the panel.
 *
 * Both branches are wired unconditionally — hooks may not be called
 * conditionally — and only the returned pair differs. In an embedded host the
 * URL values are read but never written, so a key that happens to already be on
 * the host's URL cannot steer the panel either.
 *
 * `tagFilterEntries` is never URL-backed in any host: it is an array of rich
 * filter-rule objects, too large and too structured for a query param.
 */
export function useKnowledgeListState({ host }: { host: ResourceHost }): KnowledgeListState {
  const ownsUrl = hostOwnsUrl(host)

  const [urlPage, setUrlPage] = useQueryState(pageParam.key, {
    ...pageParam.parser,
    ...pageUrlKeys,
  })
  const [{ q: urlSearch, enabled: urlEnabled }, setUrlFilters] = useQueryStates(
    documentFiltersParsers,
    documentFiltersUrlKeys
  )
  const urlSort = useUrlSort(kbDocumentSortParams, documentFiltersUrlKeys)
  const [urlAddConnectorType, setUrlAddConnectorType] = useQueryState(
    addConnectorParam.key,
    addConnectorParam.parser
  )

  const [localPage, setLocalPage] = useState(1)
  const [localSearch, setLocalSearch] = useState('')
  const [localEnabled, setLocalEnabled] = useState<KnowledgeEnabledFilter>('all')
  const [localSort, setLocalSort] = useState<{ column: string; direction: SortDirection }>(
    DEFAULT_SORT
  )
  const [localAddConnectorType, setLocalAddConnectorType] = useState<string | null>(null)
  const [tagFilterEntries, setTagFilterEntriesState] = useState<TagFilterEntry[]>([])

  const writeUrlSearch = useDebouncedSearchSetter((value, options) => {
    void setUrlFilters({ q: value }, options)
    void setUrlPage(1)
  })

  const setSearchQuery = useCallback(
    (value: string) => {
      if (ownsUrl) {
        writeUrlSearch(value)
        return
      }
      setLocalSearch(value)
      setLocalPage(1)
    },
    [ownsUrl, writeUrlSearch]
  )

  const setEnabledFilter = useCallback(
    (value: KnowledgeEnabledFilter) => {
      if (ownsUrl) {
        void setUrlFilters({ enabled: value })
        void setUrlPage(1)
        return
      }
      setLocalEnabled(value)
      setLocalPage(1)
    },
    [ownsUrl, setUrlFilters, setUrlPage]
  )

  const setCurrentPage = useCallback(
    (page: number) => {
      if (ownsUrl) {
        void setUrlPage(page)
        return
      }
      setLocalPage(page)
    },
    [ownsUrl, setUrlPage]
  )

  const setTagFilterEntries = useCallback(
    (entries: TagFilterEntry[]) => {
      setTagFilterEntriesState(entries)
      setCurrentPage(1)
    },
    [setCurrentPage]
  )

  const setAddConnectorType = useCallback(
    (value: string | null) => {
      if (ownsUrl) {
        void setUrlAddConnectorType(value, { history: 'replace', scroll: false })
        return
      }
      setLocalAddConnectorType(value)
    },
    [ownsUrl, setUrlAddConnectorType]
  )

  const localOnSort = useCallback((column: string, direction: SortDirection) => {
    if (!(KB_SORT_COLUMNS as readonly string[]).includes(column)) return
    setLocalSort({ column, direction })
    setLocalPage(1)
  }, [])

  const localOnClear = useCallback(() => {
    setLocalSort(DEFAULT_SORT)
    setLocalPage(1)
  }, [])

  const searchQuery = ownsUrl ? urlSearch : localSearch
  const enabledFilter = ownsUrl ? urlEnabled : localEnabled
  const currentPage = ownsUrl ? urlPage : localPage
  const sortColumn = ownsUrl ? urlSort.sort : localSort.column
  const sortDirection = ownsUrl ? urlSort.dir : localSort.direction
  const addConnectorType = ownsUrl ? urlAddConnectorType : localAddConnectorType

  const debouncedSearchQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS)

  /**
   * Sorting (or clearing the sort) resets pagination to the first page. In the
   * URL branch the reset is a second write; nuqs batches both into one update.
   */
  const sort = useMemo<Omit<SortConfig, 'options'>>(() => {
    if (!ownsUrl) {
      const isDefault =
        localSort.column === DEFAULT_SORT.column && localSort.direction === DEFAULT_SORT.direction
      return {
        active: isDefault ? null : localSort,
        onSort: localOnSort,
        onClear: localOnClear,
      }
    }
    return {
      active: urlSort.activeSort,
      onSort: (column, direction) => {
        urlSort.onSort(column, direction)
        void setUrlPage(1)
      },
      onClear: () => {
        urlSort.onClear()
        void setUrlPage(1)
      },
    }
  }, [ownsUrl, localSort, localOnSort, localOnClear, urlSort, setUrlPage])

  const activeTagFilters = useMemo<DocumentTagFilter[]>(
    () =>
      tagFilterEntries.reduce<DocumentTagFilter[]>((acc, f) => {
        if (!f.tagSlot || !f.value.trim()) return acc
        /**
         * A `between` filter only applies once both bounds are set. Sending it
         * with just the lower bound would be rejected at the API boundary and
         * break the whole list while the user is still entering the range.
         */
        if (f.operator === 'between' && !f.valueTo.trim()) return acc
        acc.push({
          tagSlot: f.tagSlot,
          fieldType: f.fieldType,
          operator: f.operator,
          value: f.value,
          ...(f.operator === 'between' ? { valueTo: f.valueTo } : {}),
        })
        return acc
      }, []),
    [tagFilterEntries]
  )

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    highlightQuery: searchQuery.trim(),
    enabledFilter,
    setEnabledFilter,
    tagFilterEntries,
    setTagFilterEntries,
    activeTagFilters,
    currentPage,
    setCurrentPage,
    sortColumn,
    sortDirection,
    sort,
    addConnectorType,
    setAddConnectorType,
  }
}
