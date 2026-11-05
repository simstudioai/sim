'use client'

import { type ReactElement, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/platform/design-system/components'
import { inAppLinkDestination, useBeforeUnloadWhile } from '@/platform/lib/data/navigation-guard'

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

  useBeforeUnloadWhile(isDirty || Boolean(navigationBlocked))

  useEffect(() => {
    function interceptLink(event: MouseEvent) {
      const { dirty, blocked } = guarded.current
      if (!dirty && !blocked) return
      const destination = inAppLinkDestination(event)
      if (!destination) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (blocked) return
      setPending(
        () => () => router.push(destination.pathname + destination.search + destination.hash)
      )
    }
    document.addEventListener('click', interceptLink, true)
    return () => document.removeEventListener('click', interceptLink, true)
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
