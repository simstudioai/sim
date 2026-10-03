'use client'

import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { Chip, useNativeSurfaceOcclusionReady } from '@sim/emcn'
import { getDesktopBridge, getDesktopShellVersion, getDesktopUpdates } from '@/lib/desktop'
import { isShellOutdated } from '@/lib/desktop/min-version'
import { useDesktopUpdateState } from '@/hooks/use-desktop-update-state'

/**
 * Resolves this deployment's channel to the newest release's installer, so a
 * manual download lands on the same build the updater would have installed.
 */
const DOWNLOAD_REDIRECT_PATH = '/api/desktop/update/download'

const DOWNLOAD_FALLBACK_URL = 'https://github.com/simstudioai/sim/releases/latest'

function manualDownloadUrl(): string {
  const origin = window.location.origin
  // openExternal only accepts https, so an http self-hosted origin cannot
  // serve the redirect to the system browser.
  return origin.startsWith('https://')
    ? `${origin}${DOWNLOAD_REDIRECT_PATH}`
    : DOWNLOAD_FALLBACK_URL
}

interface GateAction {
  label: string
  disabled?: boolean
  onClick: () => void
}

function gateActionFor(state: DesktopUpdateState): GateAction {
  const updates = getDesktopUpdates()
  if (!updates) {
    // Shells too old to expose the updater surface still auto-update in the
    // background; the button covers the manual path.
    return {
      label: 'Get the latest version',
      onClick: () => void getDesktopBridge()?.openExternal(manualDownloadUrl()),
    }
  }
  switch (state.status) {
    case 'checking':
      return { label: 'Checking for updates…', disabled: true, onClick: () => {} }
    case 'downloading':
      return {
        label:
          state.percent !== undefined ? `Downloading ${state.percent}%` : 'Downloading update…',
        disabled: true,
        onClick: () => {},
      }
    case 'ready':
      return { label: 'Restart to update', onClick: () => updates.install() }
    default:
      // idle, available, and error all advance the same way: check() checks
      // for an update or starts the download of one already found.
      return { label: 'Download update', onClick: () => updates.check() }
  }
}

/**
 * The minimum-shell-version takeover for the desktop app.
 *
 * The web app deploys continuously while installed shells lag behind. Bridge
 * changes must normally stay backward compatible (enforced in CI by the
 * desktop-bridge contract audit); when a release is genuinely breaking,
 * `MIN_DESKTOP_VERSION` is bumped and shells below it get this full-screen
 * blocker instead of silently broken features. Renders nothing in browsers
 * and on shells at or above the floor.
 */
export function DesktopUpdateGate() {
  const [outdated, setOutdated] = useState(false)
  const updateState = useDesktopUpdateState()

  useEffect(() => {
    if (!getDesktopBridge() || !isShellOutdated(getDesktopShellVersion())) {
      return
    }
    setOutdated(true)
  }, [])

  const nativeSurfaceReady = useNativeSurfaceOcclusionReady(outdated, 'takeover')

  if (!outdated) {
    return null
  }

  const action = gateActionFor(updateState)

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
      {updateState.status === 'error' && (
        <p className='text-[var(--text-error)] text-xs'>
          The update could not be downloaded. Check your connection and try again.
        </p>
      )}
    </div>
  )
}
