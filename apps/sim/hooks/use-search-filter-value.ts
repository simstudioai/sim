'use client'

import { useEffect, useState } from 'react'

/**
 * The search term a list should actually filter by: debounced while the user types, but
 * discarded the moment the term is cleared.
 *
 * A plain trailing debounce keeps filtering by the old term for a full window after a clear.
 * Typing can afford that — nobody expects results before they stop typing — but clearing
 * cannot, because clearing is how a list stops being a search. On a foldered list the term is
 * cleared as part of opening a folder, so a trailing edge leaves the previous whole-workspace
 * results on screen after the breadcrumb has already changed, and the rows snap a fifth of a
 * second later. The click reads as having done nothing, twice.
 *
 * Masking the settled term while the input is empty is not enough, because the mask lifts as
 * soon as the user types again: between that keystroke and the end of its own window the hook
 * would hand back the term from *before* the clear, and the list would search the whole
 * workspace for something the user had already abandoned. So a clear resets the settled term
 * rather than hiding it, and the next term applies only once it settles on its own.
 */
export function useSearchFilterValue(value: string, delayMs: number): string {
  const isSearching = value.trim().length > 0
  /** Seeded from the first value so a deep-linked `?search=` filters on the first render. */
  const [settled, setSettled] = useState(() => (value.trim() ? value : ''))
  const [wasSearching, setWasSearching] = useState(isSearching)

  /**
   * Adjusted during render rather than in an effect so the reset is already visible to the
   * render that follows the clear — an effect would land a frame later, which is the same
   * stale window in a smaller costume. See `.claude/rules/sim-hooks.md`, "State shape".
   */
  if (wasSearching !== isSearching) {
    setWasSearching(isSearching)
    if (!isSearching) setSettled('')
  }

  useEffect(() => {
    if (!isSearching) return
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, isSearching, delayMs])

  return isSearching ? settled : ''
}
