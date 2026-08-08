'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueryStates } from 'nuqs'
import {
  DEFAULT_TABLE_DETAIL_SORT_DIRECTION,
  tableDetailParsers,
  tableDetailUrlKeys,
} from '@/lib/table/detail-search-params'
import type { SortDirection } from '@/lib/url-state'
import { hostOwnsUrl, type ResourceHost } from '@/resources'

/** Sort column, direction, and active view id — the table's deep-linkable view state. */
export interface TableDetailState {
  sort: string | null
  dir: SortDirection
  view: string | null
}

/** A partial write. `null` resets a key to its default, exactly as nuqs does. */
export type TableDetailUpdate = Partial<{
  sort: string | null
  dir: SortDirection | null
  view: string | null
}>

const LOCAL_DEFAULTS: TableDetailState = {
  sort: null,
  dir: DEFAULT_TABLE_DETAIL_SORT_DIRECTION,
  view: null,
}

/**
 * The table's sort/view state, stored where the host allows.
 *
 * A host that owns the URL keeps `sort` / `dir` / `table-view` as query params,
 * so a table is shareable and survives reload. An embedded host holds the
 * identical values locally, because writing unnamespaced keys would pollute the
 * address bar of whatever page is hosting the panel — the mothership binds these
 * parsers to `/home`, where they belong to the home page and not to whichever
 * table happens to be open in a tab.
 *
 * Both branches are wired unconditionally (hooks may not be called
 * conditionally) and only the returned pair differs, matching
 * `useKnowledgeListState`. In an embedded host the URL values are read but never
 * written, so a key that happens to already be on the host's URL cannot steer
 * the panel either.
 *
 * The local branch is deliberately ONE state object rather than three. Several
 * writers set multiple keys in a single call — clearing an inherited view writes
 * `{ view, sort, dir }` together — and rely on nuqs batching them into one
 * update. Three separate setters would produce a different render count and can
 * tear midway through the view-resolution effect's latch.
 */
export function useTableDetailState({
  host,
}: {
  host: ResourceHost
}): [TableDetailState, (update: TableDetailUpdate) => void] {
  const ownsUrl = hostOwnsUrl(host)

  const [urlState, setUrlState] = useQueryStates(tableDetailParsers, tableDetailUrlKeys)
  const [localState, setLocalState] = useState<TableDetailState>(LOCAL_DEFAULTS)

  const setLocal = useCallback((update: TableDetailUpdate) => {
    setLocalState((previous) => ({
      sort: 'sort' in update ? (update.sort ?? null) : previous.sort,
      dir: 'dir' in update ? (update.dir ?? DEFAULT_TABLE_DETAIL_SORT_DIRECTION) : previous.dir,
      view: 'view' in update ? (update.view ?? null) : previous.view,
    }))
  }, [])

  const setState = useCallback(
    (update: TableDetailUpdate) => {
      if (ownsUrl) {
        void setUrlState(update)
        return
      }
      setLocal(update)
    },
    [ownsUrl, setUrlState, setLocal]
  )

  const state = useMemo<TableDetailState>(
    () => (ownsUrl ? { sort: urlState.sort, dir: urlState.dir, view: urlState.view } : localState),
    [ownsUrl, urlState.sort, urlState.dir, urlState.view, localState]
  )

  return [state, setState]
}
