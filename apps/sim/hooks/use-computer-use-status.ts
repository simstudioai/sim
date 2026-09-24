import { useCallback, useEffect, useState } from 'react'
import type { ComputerUseStatus } from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'

/** Refresh native permissions when the user returns from System Settings and on activity changes. */
export function useComputerUseStatus() {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [error, setError] = useState(false)
  const refresh = useCallback(async () => {
    const bridge = getDesktopBridge()?.computerUse
    if (!bridge) return
    try {
      setStatus(await bridge.getStatus())
      setError(false)
    } catch {
      setError(true)
    }
  }, [])
  useEffect(() => {
    const bridge = getDesktopBridge()?.computerUse
    if (!bridge) return
    void refresh()
    const unsubscribe = bridge.onActivity((activeAction) => {
      setStatus((current) => (current ? { ...current, activeAction } : current))
      void refresh()
    })
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])
  return { status, setStatus, refresh, error }
}
