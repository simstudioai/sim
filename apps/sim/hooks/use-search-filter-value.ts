'use client'

import { useDebounce } from '@/hooks/use-debounce'

/**
 * The search term a list should actually filter by: debounced while the user types, but
 * applied immediately when the term is cleared.
 *
 * {@link useDebounce} is trailing-only, so a cleared term keeps filtering for a full window.
 * Typing can afford that — nobody expects results before they stop typing — but clearing
 * cannot, because clearing is how a list stops being a search. On a foldered list the term
 * is cleared as part of opening a folder, so the trailing edge leaves the previous
 * whole-workspace results on screen after the breadcrumb has already changed, and the rows
 * then snap a fifth of a second later. The click reads as having done nothing, twice.
 *
 * Returns the raw value's emptiness, not the debounced one's, so the transition out of
 * searching is instant in both directions it matters: the filter widens on a beat, and
 * narrows back to the open folder at once.
 */
export function useSearchFilterValue(value: string, delayMs: number): string {
  const debounced = useDebounce(value, delayMs)
  return value.trim() ? debounced : ''
}
