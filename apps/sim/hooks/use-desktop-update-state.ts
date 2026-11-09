'use client'

import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { getDesktopUpdates } from '@/lib/desktop'

export function hasAvailableDesktopUpdate(state: DesktopUpdateState): boolean {
  return state.status === 'available' || state.status === 'downloading' || state.status === 'ready'
}

export function desktopUpdateActionLabel(state: DesktopUpdateState): string {
  if (state.status === 'downloading') {
    return state.percent === undefined
      ? 'Downloading update…'
      : `Downloading update ${state.percent}%`
  }
  return state.status === 'ready' ? 'Restart to update' : 'Update'
}

const INITIAL_UPDATE_STATE: DesktopUpdateState = { status: 'idle' }

export function useDesktopUpdateState(): DesktopUpdateState {
  const [state, setState] = useState<DesktopUpdateState>(INITIAL_UPDATE_STATE)

  useEffect(() => {
    const updates = getDesktopUpdates()
    if (!updates) return

    let active = true
    let eventReceived = false
    const unsubscribe = updates.onState((next) => {
      if (!active) return
      eventReceived = true
      setState(next)
    })
    void updates
      .getState()
      .then((next) => {
        if (active && !eventReceived) setState(next)
      })
      .catch(() => {})

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return state
}
