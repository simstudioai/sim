'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@sim/emcn'
import { getDesktopShellVersion, getDesktopUpdates } from '@/lib/desktop'
import { isShellOutdated } from '@/lib/desktop/min-version'
import { useDesktopUpdateState } from '@/hooks/use-desktop-update-state'

interface DesktopUpdateNotificationProps {
  [key: string]: never
}

/** Keeps optional desktop updates actionable across routes for the current window session. */
export function DesktopUpdateNotification(_props: DesktopUpdateNotificationProps) {
  const { status, version, manual } = useDesktopUpdateState()
  const { toast, dismiss } = useToast()
  const dismissedOffer = useRef<string | null>(null)

  useEffect(() => {
    const updates = getDesktopUpdates()
    if (
      !updates ||
      isShellOutdated(getDesktopShellVersion()) ||
      (status !== 'available' && status !== 'ready')
    ) {
      return
    }

    const offer = `${version ?? ''}:${status}:${Boolean(manual)}`
    if (dismissedOffer.current === offer) return

    let active = true
    const id = toast({
      message:
        status === 'ready' ? 'A Sim update is ready to install' : 'A Sim update is available',
      action: {
        label: status === 'ready' ? 'Restart to update' : 'Download update',
        onClick: () => {
          if (!active) return
          if (status === 'ready' || manual) updates.install()
          else updates.check()
        },
      },
      persistAcrossRoutes: true,
      onUserDismiss: () => {
        if (active) dismissedOffer.current = offer
      },
    })

    return () => {
      // Ignore clicks while a withdrawn toast finishes its exit animation.
      active = false
      dismiss(id)
    }
  }, [status, version, manual, toast, dismiss])

  return null
}
