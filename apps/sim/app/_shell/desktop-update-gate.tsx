'use client'

import { Chip, useNativeSurfaceOcclusionReady } from '@sim/emcn-legacy'
import { useDesktopUpdateGate } from '@/hooks/use-desktop-update-gate'

/**
 * The site root's minimum-shell-version takeover for the desktop app (see
 * {@link useDesktopUpdateGate}). Renders nothing in browsers and on shells at
 * or above the floor.
 */
export function DesktopUpdateGate() {
  const { outdated, action, failed } = useDesktopUpdateGate()
  const nativeSurfaceReady = useNativeSurfaceOcclusionReady(outdated, 'takeover')

  if (!outdated) {
    return null
  }

  return (
    <div
      className='fixed inset-0 z-[var(--z-shell-gate)] flex flex-col items-center justify-center gap-4 bg-[var(--bg)] px-8 text-center'
      style={{ visibility: nativeSurfaceReady ? undefined : 'hidden' }}
      data-native-surface-occlusion='takeover'
    >
      <div className='flex max-w-sm flex-col gap-2'>
        <h1 className='text-[var(--text-primary)] text-lg'>Update Sim to continue</h1>
        <p className='text-[var(--text-secondary)] text-sm'>
          This version of the Sim desktop app is no longer compatible with the latest Sim. Install
          the update to keep going.
        </p>
      </div>
      <Chip variant='primary' disabled={action.disabled} onClick={action.onClick}>
        {action.label}
      </Chip>
      {failed && (
        <p className='text-[var(--text-error)] text-xs'>
          The update could not be downloaded. Check your connection and try again.
        </p>
      )}
    </div>
  )
}
