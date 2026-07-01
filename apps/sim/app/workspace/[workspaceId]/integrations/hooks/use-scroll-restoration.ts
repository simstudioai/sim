'use client'

import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/** Namespace prefix so restoration keys never collide with other tab state. */
const STORAGE_PREFIX = 'integrations-scroll:' as const

interface UseScrollRestorationOptions {
  /**
   * Flag that flips to `true` once the async content the scroll height depends
   * on has settled (e.g. the credentials query is no longer pending). A late
   * restore is re-attempted when this transitions so we do not clamp against a
   * too-short container while data is still loading.
   */
  ready?: boolean
}

/**
 * Restores the scroll position of an inner scroll container across browser
 * back/forward navigation within the same tab.
 *
 * Next.js App Router only restores WINDOW scroll, so a page whose content
 * scrolls inside a nested `overflow-y-auto` element loses its position on Back.
 * This hook persists `scrollTop` in `sessionStorage` (per-pathname, tab-scoped)
 * and re-applies it once the container has laid out.
 *
 * Save cadence: the container's `scroll` event is throttled through a single
 * `requestAnimationFrame` so at most one write happens per frame, and the
 * latest position is flushed synchronously on unmount/navigation so a throttled
 * final scroll is never lost.
 *
 * Restore timing: restoration runs in `useLayoutEffect` (before paint) on mount
 * and again whenever `ready` transitions, guarding against async content that
 * inflates the container height after first render. It stops after the first
 * successful non-zero apply, or as soon as the user scrolls, so it never fights
 * a user who has already moved.
 *
 * @param containerRef Ref to the scrollable container element.
 * @param options      `ready` marks async content as settled for a late retry.
 */
export function useScrollRestoration(
  containerRef: RefObject<HTMLDivElement | null>,
  { ready = true }: UseScrollRestorationOptions = {}
): void {
  const pathname = usePathname()
  const storageKey = `${STORAGE_PREFIX}${pathname}`

  const storageKeyRef = useRef(storageKey)
  const hasRestoredRef = useRef(false)
  const userScrolledRef = useRef(false)
  const programmaticRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    storageKeyRef.current = storageKey
  }, [storageKey])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const persist = () => {
      try {
        sessionStorage.setItem(storageKeyRef.current, String(el.scrollTop))
      } catch {}
    }

    const onScroll = () => {
      if (programmaticRef.current) {
        programmaticRef.current = false
        return
      }
      userScrolledRef.current = true
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        persist()
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      persist()
    }
  }, [containerRef])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || hasRestoredRef.current || userScrolledRef.current) return

    let target = 0
    try {
      const raw = sessionStorage.getItem(storageKeyRef.current)
      target = raw ? Number(raw) : 0
    } catch {}

    if (!Number.isFinite(target) || target <= 0) return

    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return

    programmaticRef.current = true
    el.scrollTop = Math.min(target, maxScroll)

    if (maxScroll >= target) hasRestoredRef.current = true
  }, [containerRef, ready])
}
