'use client'

import { useCallback, useMemo } from 'react'
import { type Options, useQueryStates } from 'nuqs'
import type { DefaultedSortParams, NullableSortParams, SortDirection } from '@/lib/url-state'

/** The nullable active-sort shape the shared sort menu (`SortConfig`) consumes. */
export interface ActiveSort {
  column: string
  direction: SortDirection
}

export interface UseUrlSortReturn<Sort, Dir> {
  /** Raw resolved column — feed this to query keys / comparators. */
  sort: Sort
  /** Raw resolved direction. */
  dir: Dir
  /** `null` when the list shows no active sort; plugs into `SortConfig.active`. */
  activeSort: ActiveSort | null
  /** Validates the column against the param's literal set; no-op on unknown ids. */
  onSort: (column: string, direction: SortDirection) => void
  /** Defaulted mode writes the defaults back (stripped by `clearOnDefault`); nullable mode strips both params. */
  onClear: () => void
}

/**
 * Binds a `createSortParams` definition (from `@/lib/url-state/sort-params`)
 * to the URL and derives the canonical sort wiring for a sortable list:
 * defaulted mode collapses an explicit default selection to "no active sort",
 * nullable mode treats `null` params as the distinct unsorted state. Pass the
 * feature's shared url-keys object (e.g. `{ history: 'replace', shallow: true,
 * clearOnDefault: true }`) as `options`.
 */
export function useUrlSort<C extends string>(
  params: DefaultedSortParams<C>,
  options?: Options
): UseUrlSortReturn<C, SortDirection>
export function useUrlSort<C extends string>(
  params: NullableSortParams<C>,
  options?: Options
): UseUrlSortReturn<C | null, SortDirection | null>
export function useUrlSort<C extends string>(
  params: DefaultedSortParams<C> | NullableSortParams<C>,
  options: Options = {}
): UseUrlSortReturn<C | null, SortDirection | null> {
  const [values, setValues] = useQueryStates(
    params.parsers as NullableSortParams<C>['parsers'],
    options
  )
  const sort = values.sort ?? null
  const dir = values.dir ?? null
  const sortDefault = params.default

  const activeSort = useMemo<ActiveSort | null>(() => {
    if (sortDefault !== null) {
      return sort === sortDefault.column && dir === sortDefault.direction
        ? null
        : { column: sort as string, direction: dir as SortDirection }
    }
    return sort !== null && dir !== null ? { column: sort, direction: dir } : null
  }, [sortDefault, sort, dir])

  const onSort = useCallback(
    (column: string, direction: SortDirection) => {
      if (!(params.columns as readonly string[]).includes(column)) return
      void setValues({ sort: column as C, dir: direction })
    },
    [params, setValues]
  )

  const onClear = useCallback(() => {
    void setValues(
      sortDefault !== null
        ? { sort: sortDefault.column, dir: sortDefault.direction }
        : { sort: null, dir: null }
    )
  }, [sortDefault, setValues])

  return { sort, dir, activeSort, onSort, onClear }
}
