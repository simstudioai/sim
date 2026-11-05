'use client'

import { type ReactElement, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/platform/design-system/components'

interface UnsavedGuardOptions {
  isDirty: boolean
  /** A write is underway, so leaving is refused rather than offered. */
  navigationBlocked?: boolean
  onDiscard: () => void
}

interface UnsavedGuard {
  /** Runs `leave` now, or after the viewer agrees to lose their edits. */
  guardBack: (leave: () => void) => void
  /** Render once; it is the discard confirmation. */
  dialog: ReactElement
}

/**
 * Keeps a dirty editor from being left by accident: a sub-view's back action, a link anywhere in the
 * shell, and closing or reloading the tab. Browser back within the app is not intercepted.
 */
export function useUnsavedGuard({
  isDirty,
  navigationBlocked,
  onDiscard,
}: UnsavedGuardOptions): UnsavedGuard {
  const router = useRouter()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const guarded = useRef({ dirty: false, blocked: false })
  guarded.current = { dirty: isDirty, blocked: Boolean(navigationBlocked) }

  useEffect(() => {
    function refuseUnload(event: BeforeUnloadEvent) {
      if (guarded.current.dirty || guarded.current.blocked) event.preventDefault()
    }
    function interceptLink(event: MouseEvent) {
      const { dirty, blocked } = guarded.current
      if (!(dirty || blocked) || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return
      if (link.origin !== window.location.origin) return
      event.preventDefault()
      event.stopPropagation()
      if (blocked) return
      setPending(() => () => router.push(`${link.pathname}${link.search}${link.hash}`))
    }
    window.addEventListener('beforeunload', refuseUnload)
    document.addEventListener('click', interceptLink, true)
    return () => {
      window.removeEventListener('beforeunload', refuseUnload)
      document.removeEventListener('click', interceptLink, true)
    }
  }, [router])

  return {
    guardBack: (leave) => {
      if (navigationBlocked) return
      if (isDirty) setPending(() => leave)
      else leave()
    },
    dialog: (
      <Modal
        variant='confirm'
        destructive
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title='Discard changes?'
        description='You have unsaved changes. Leaving now discards them.'
        confirmLabel='Discard'
        onConfirm={() => {
          onDiscard()
          pending?.()
          setPending(null)
        }}
      />
    ),
  }
}
