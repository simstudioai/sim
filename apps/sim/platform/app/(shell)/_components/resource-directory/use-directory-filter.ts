'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/** Commit a local filter before a result link can start navigating to its detail. */
function useDirectoryFilter(key: string, initial: string) {
  const params = useSearchParams()
  const [value, setValue] = useState(() => params.get(key) ?? initial)
  useEffect(() => {
    const committed = params.get(key) ?? initial
    if (committed === (new URLSearchParams(window.location.search).get(key) ?? initial)) {
      setValue(committed)
    }
  }, [initial, key, params])

  function change(next: string) {
    const url = new URL(window.location.href)
    if (next && next !== initial) url.searchParams.set(key, next)
    else url.searchParams.delete(key)
    window.history.replaceState(null, '', url)
    setValue(next)
  }
  return [value, change] as const
}

export function useDirectorySearch() {
  const [query, setQuery] = useDirectoryFilter('q', '')
  return { query, setQuery }
}
