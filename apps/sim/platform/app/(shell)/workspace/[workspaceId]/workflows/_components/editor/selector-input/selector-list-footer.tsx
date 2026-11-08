'use client'

import { Button } from '@sim/emcn/button'
import type { PickerServerSearch } from '@sim/emcn/picker/search-popup'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/selector-input/selector-input.module.css'
import type { SelectorSearch } from '@/platform/lib/data/workflow-editor/selectors'

/** A provider-backed list's progress, as `useSelectorOptions` and `useFetchedOptions` report it. */
interface SelectorListState {
  isLoading: boolean
  isFetchingMore: boolean
  isLoadingAll: boolean
  hasMore: boolean
  truncated: boolean
  error: string | null
  loadMore: () => void
  loadAll: () => void
}

interface SelectorListFooterProps {
  /** Searches every page when a search narrows a list that has not loaded them all. */
  onSearchAll?: () => void
  searchingAll: boolean
  /** The provider capped the list, so what it shows is partial. */
  partial: boolean
}

function SelectorListFooter({ onSearchAll, searchingAll, partial }: SelectorListFooterProps) {
  if (onSearchAll)
    return (
      <div className={styles.listFooter}>
        <Button variant='quiet' size='compact' disabled={searchingAll} onClick={onSearchAll}>
          {searchingAll ? 'Searching options…' : 'Search all options'}
        </Button>
      </div>
    )
  if (!partial) return null
  return (
    <p className={styles.listNote} data-type='T052'>
      Showing partial results
    </p>
  )
}

/**
 * The picker search for a provider-backed list: the typed query (debounced before it reaches the
 * provider), paging as the list scrolls, every page when a search needs them, and the empty and
 * partial states the legacy list named.
 */
export function selectorPickerSearch(
  search: SelectorSearch,
  list: SelectorListState,
  hasOptions: boolean
): PickerServerSearch {
  const searching = search.query.trim().length > 0
  const searchAll = searching && list.hasMore
  return {
    query: search.query,
    onQueryChange: (query, { reason }) => {
      if (reason !== 'item-press') search.setQuery(query)
    },
    hasMore: list.hasMore && !searchAll,
    loading: list.isLoading || list.isFetchingMore || list.isLoadingAll,
    error: list.error ?? undefined,
    onLoadMore: list.loadMore,
    emptyMessage:
      list.truncated && searching
        ? 'No matches in partial results'
        : list.hasMore && searching
          ? 'No matches in loaded options'
          : list.hasMore
            ? 'No options loaded'
            : searching
              ? 'No matching options found'
              : 'No options available',
    footer: (
      <SelectorListFooter
        onSearchAll={searchAll ? list.loadAll : undefined}
        searchingAll={list.isLoadingAll}
        partial={list.truncated && hasOptions}
      />
    ),
  }
}
