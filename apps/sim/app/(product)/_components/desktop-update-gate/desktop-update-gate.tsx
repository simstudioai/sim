'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { InlineNotice } from '@sim/emcn/status'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import styles from '@/app/(product)/_components/desktop-update-gate/desktop-update-gate.module.css'
import { useDesktopUpdateGate } from '@/platform/lib/data/desktop'

/**
 * The product root's minimum-shell-version takeover: a desktop shell below the floor gets this
 * full-window blocker instead of silently broken features. Nothing in browsers or on current shells.
 * The product mounts no native surface that must move behind it, so it paints at once.
 */
export function DesktopUpdateGate() {
  const { outdated, action, failed } = useDesktopUpdateGate()
  if (!outdated) return null
  return (
    <PlatformSurface theme='system'>
      <main className={styles.gate}>
        <EmptyState
          title='Update Sim to continue'
          description='This version of the Sim desktop app is no longer compatible with the latest Sim. Install the update to keep going.'
          action={
            <div className={styles.actions}>
              <Button variant='primary' disabled={action.disabled} onClick={action.onClick}>
                {action.label}
              </Button>
              {failed && (
                <InlineNotice
                  intent='danger'
                  message='The update could not be downloaded. Check your connection and try again.'
                />
              )}
            </div>
          }
        />
      </main>
    </PlatformSurface>
  )
}
