import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComputerUseStatus } from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'

/** Refresh native permissions when the user returns from System Settings and on activity changes. */
export function useComputerUseStatus() {
  const requestVersion = useRef(0)
  const [status, setStatus] = useState<Omit<ComputerUseStatus, 'activeAction'> | null>(null)
  const [activeAction, setActiveAction] = useState<ComputerUseStatus['activeAction']>(null)
  const [error, setError] = useState(false)
  const updateStatus = useCallback((nextStatus: ComputerUseStatus) => {
    requestVersion.current += 1
    const { activeAction: nextActivity, ...nextPermissions } = nextStatus
    setStatus(nextPermissions)
    setActiveAction(nextActivity)
    setError(false)
  }, [])
  const refresh = useCallback(async () => {
    const bridge = getDesktopBridge()?.computerUse
    if (!bridge) return
    const version = ++requestVersion.current
    try {
      const nextStatus = await bridge.getStatus()
      if (version !== requestVersion.current) return
      updateStatus(nextStatus)
    } catch {
      if (version !== requestVersion.current) return
      setError(true)
    }
  }, [updateStatus])
  useEffect(() => {
    const bridge = getDesktopBridge()?.computerUse
    if (!bridge) return
    void refresh()
    const unsubscribe = bridge.onActivity((activeAction) => {
      setActiveAction(activeAction)
      void refresh()
    })
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      requestVersion.current += 1
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])
  return {
    status: status ? { ...status, activeAction } : null,
    activeAction,
    setStatus: updateStatus,
    refresh,
    error,
  }
}
