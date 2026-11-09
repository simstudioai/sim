'use client'

import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
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

interface DesktopUpdateGateAction {
  label: string
  disabled?: boolean
  onClick: () => void
}

function gateActionFor(state: DesktopUpdateState): DesktopUpdateGateAction {
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
      return { label: 'Restart to update', onClick: () => updates.install({ mandatory: true }) }
    default:
      // idle, available, and error all advance the same way: check() checks
      // for an update or starts the download of one already found.
      return { label: 'Download update', onClick: () => updates.check() }
  }
}

/**
 * The minimum-shell-version takeover's state for the desktop app.
 *
 * The web app deploys continuously while installed shells lag behind. Bridge
 * changes must normally stay backward compatible (enforced in CI by the
 * desktop-bridge contract audit); when a release is genuinely breaking,
 * `MIN_DESKTOP_VERSION` is bumped and shells below it are `outdated`, so every
 * root blocks them instead of leaving features silently broken. Never
 * `outdated` in browsers or on shells at or above the floor.
 */
export function useDesktopUpdateGate() {
  const [outdated, setOutdated] = useState(false)
  const updateState = useDesktopUpdateState()

  useEffect(() => {
    if (!getDesktopBridge() || !isShellOutdated(getDesktopShellVersion())) {
      return
    }
    setOutdated(true)
  }, [])

  return {
    outdated,
    action: gateActionFor(updateState),
    failed: updateState.status === 'error',
  }
}
