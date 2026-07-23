'use client'

import { useCallback, useRef } from 'react'
import { debounce, type Options } from 'nuqs'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'

type SearchWrite = (value: string | null, options?: Options) => void

interface UseDebouncedSearchSetterOptions {
  debounceMs?: number
}

/**
 * The canonical setter for a nuqs-backed search param (see
 * `.claude/rules/sim-url-state.md`, "Debounced text inputs"). The input stays
 * controlled by the instant nuqs value; only the URL write is debounced.
 * Clearing (or a whitespace-only value) writes `null` immediately so the param
 * strips without lingering. The RAW value is written — never a trimmed one,
 * which would eat the user's trailing space mid-typing; consumers trim on read.
 *
 * Grouped params: `useDebouncedSearchSetter((v, o) => setFilters({ search: v }, o))`.
 * Single param: pass the `useQueryState` setter directly.
 */
export function useDebouncedSearchSetter(
  write: SearchWrite,
  { debounceMs = SEARCH_DEBOUNCE_MS }: UseDebouncedSearchSetterOptions = {}
): (value: string) => void {
  const writeRef = useRef(write)
  writeRef.current = write

  return useCallback(
    (value: string) => {
      const next = value.trim().length > 0 ? value : null
      writeRef.current(next, next === null ? undefined : { limitUrlUpdates: debounce(debounceMs) })
    },
    [debounceMs]
  )
}
