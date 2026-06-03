'use client'

import type { MouseEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface UseUnsavedChangesGuardParams {
  isDirty: boolean
  /** Where a confirmed discard navigates to. */
  backHref: string
}

/**
 * Guards a detail surface against losing unsaved edits: blocks the browser
 * unload while dirty, intercepts the in-app back link and the browser
 * back/forward button to confirm, and navigates on discard. Shared by every
 * credential detail surface so the behavior is identical.
 */
export function useUnsavedChangesGuard({ isDirty, backHref }: UseUnsavedChangesGuardParams) {
  const router = useRouter()
  const [showUnsavedAlert, setShowUnsavedAlert] = useState(false)

  useEffect(() => {
    if (!isDirty) return
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
