'use client'

import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/** Namespace prefix so restoration keys never collide with other tab state. */
const STORAGE_PREFIX = 'integrations-scroll:' as const

/**
 * True when the most recent navigation was a Back/Forward history traversal.
 *
 * A single module-level `popstate` listener flips this before the destination
 * page mounts; each restore reads it once and clears it. Fresh push navigations
 * (a sidebar link, a typed URL) never fire `popstate`, so the flag stays false
 * and those visits open at the top instead of jumping to a stale position.
 * Registered at module load — a per-hook listener would attach too late to see
 * the `popstate` that triggered its own mount.
 */
let lastNavWasTraversal = false
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastNavWasTraversal = true
  })
}

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
 * Back/Forward navigation within the same tab.
 *
 * Next.js App Router only restores WINDOW scroll, so a page whose content
 * scrolls inside a nested `overflow-y-auto` element loses its position on Back.
 * This hook persists `scrollTop` in `sessionStorage` (per-pathname, tab-scoped)
 * and re-applies it — only on history traversals — once the container has laid
 * out.
 *
 * Programmatic vs. user scrolls are told apart by VALUE, not a one-shot event
 * flag: a restore assigns `scrollTop === lastAppliedRef`, so the echoed scroll
 * event compares equal and is ignored (it is never persisted, so a clamped
 * value cannot overwrite the saved target). This avoids the race where the
 * programmatic scroll event fires before the listener attaches and a stuck flag
 * drops the user's first real scroll. The restore itself latches only on a full
 * (non-clamped) apply, so a late `ready` retry can complete a position that was
 * clamped against still-loading content, and it stops the moment the user
 * scrolls away from the last applied value so it never fights them.
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
  /** Last `scrollTop` this hook assigned, so its echo scroll event is ignored. */
  const lastAppliedRef = useRef(-1)
  /** Latest user-initiated `scrollTop`, flushed to storage on unmount. */
  const latestUserScrollRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  /** Captured once per mount: did we arrive here via Back/Forward? */
  const shouldRestoreRef = useRef<boolean | null>(null)

  useEffect(() => {
    storageKeyRef.current = storageKey
  }, [storageKey])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const persist = (value: number) => {
      try {
        sessionStorage.setItem(storageKeyRef.current, String(value))
      } catch {}
    }

    const onScroll = () => {
      if (el.scrollTop === lastAppliedRef.current) return
      latestUserScrollRef.current = el.scrollTop
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        persist(el.scrollTop)
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (latestUserScrollRef.current !== null) persist(latestUserScrollRef.current)
    }
  }, [containerRef])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || hasRestoredRef.current) return

    if (shouldRestoreRef.current === null) {
      shouldRestoreRef.current = lastNavWasTraversal
      lastNavWasTraversal = false
    }
    if (!shouldRestoreRef.current) {
      hasRestoredRef.current = true
      return
    }

    if (lastAppliedRef.current !== -1 && el.scrollTop !== lastAppliedRef.current) {
      hasRestoredRef.current = true
      return
    }

    let target = 0
    try {
      const raw = sessionStorage.getItem(storageKeyRef.current)
      target = raw ? Number(raw) : 0
    } catch {}
    if (!Number.isFinite(target) || target <= 0) {
      hasRestoredRef.current = true
      return
    }

    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return

    lastAppliedRef.current = Math.min(target, maxScroll)
    el.scrollTop = lastAppliedRef.current
    if (maxScroll >= target) hasRestoredRef.current = true
  }, [containerRef, ready])
}
