import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComputerUseStatus } from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

/** Refresh native permissions when the user returns from System Settings and on activity changes. */
export function useComputerUseStatus() {
  const enabled = useFeatureFlag('mothership-computer-use')
  const requestVersion = useRef(0)
  const activityVersion = useRef(0)
  const [status, setStatus] = useState<Omit<ComputerUseStatus, 'activeAction'> | null>(null)
  const [activeAction, setActiveAction] = useState<ComputerUseStatus['activeAction']>(null)
  const [error, setError] = useState(false)
  const updateStatus = useCallback((nextStatus: ComputerUseStatus) => {
    requestVersion.current += 1
    activityVersion.current += 1
    const { activeAction: nextActivity, ...nextPermissions } = nextStatus
    setStatus(nextPermissions)
    setActiveAction(nextActivity)
    setError(false)
  }, [])
  const refresh = useCallback(async () => {
    const bridge = getDesktopBridge()?.computerUse
    if (!bridge || !enabled) return
    const version = ++requestVersion.current
    try {
      const nextStatus = await bridge.getStatus()
      if (version !== requestVersion.current) return
      updateStatus(nextStatus)
    } catch {
      if (version !== requestVersion.current) return
      setError(true)
    }
  }, [enabled, updateStatus])
  useEffect(() => {
    const bridge = getDesktopBridge()?.computerUse
    if (!bridge) return
    void refresh()
    const version = ++activityVersion.current
    const unsubscribe = bridge.onActivity((activeAction) => {
      activityVersion.current += 1
      setActiveAction(activeAction)
      void refresh()
    })
    void bridge
      .getActivity?.()
      .then((activity) => {
        if (version === activityVersion.current) setActiveAction(activity)
      })
      .catch(() => {})
    const onFocus = () => {
      void refresh()
    }
    if (enabled) window.addEventListener('focus', onFocus)
    return () => {
      requestVersion.current += 1
      activityVersion.current += 1
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, refresh])
  return {
    status: enabled && status ? { ...status, activeAction } : null,
    activeAction,
    setStatus: updateStatus,
    refresh,
    error: enabled && error,
  }
}
