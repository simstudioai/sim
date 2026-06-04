'use client'

import type { MouseEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface UseUnsavedChangesGuardParams {
  isDirty: boolean
  /** Where a confirmed discard navigates to. */
  backHref: string
}

/**
 * Guards a detail surface against losing unsaved edits: warns on browser unload
 * while dirty, intercepts the in-app back link, and traps the browser
 * back/forward button to confirm before leaving. Shared by every credential
 * detail surface so the behavior is identical.
 *
 * Native Back is trapped by seeding a single same-URL history entry while dirty,
 * so Back pops that entry (no route change) and fires popstate. The seed is
 * removed once the form is clean again (save/revert) so it never accumulates
 * across edit cycles — and that removal runs in the effect body (only while
 * still mounted), never in cleanup, so an intentional discard/navigation away is
 * not reversed.
 */
export function useUnsavedChangesGuard({ isDirty, backHref }: UseUnsavedChangesGuardParams) {
  const router = useRouter()
  const [showUnsavedAlert, setShowUnsavedAlert] = useState(false)
  const hasSentinelRef = useRef(false)

  useEffect(() => {
    if (!isDirty) {
      // Clean again while still mounted (saved/reverted): pop the seeded entry so
      // it can't pile up across edit/save cycles. This runs in the effect body,
      // never on unmount, so navigating away mid-edit is never reversed.
      if (hasSentinelRef.current) {
        hasSentinelRef.current = false
        window.history.back()
      }
      return
    }
    // Seed one same-URL entry so Back pops it (no route change) and fires
    // popstate, letting us confirm before the page actually leaves.
    if (!hasSentinelRef.current) {
      window.history.pushState(null, '', window.location.href)
      hasSentinelRef.current = true
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href)
      setShowUnsavedAlert(true)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isDirty])

  const handleBackClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (isDirty) {
        event.preventDefault()
        setShowUnsavedAlert(true)
      }
    },
    [isDirty]
  )

  const confirmDiscard = useCallback(() => {
    setShowUnsavedAlert(false)
    router.push(backHref)
  }, [router, backHref])

  return { showUnsavedAlert, setShowUnsavedAlert, handleBackClick, confirmDiscard }
}
