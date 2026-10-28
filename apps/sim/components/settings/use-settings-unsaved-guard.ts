import { useCallback, useEffect, useId, useRef } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface UseSettingsUnsavedGuardParams {
  isDirty: boolean
  navigationBlocked?: boolean
  onDiscard?: () => void
}

interface SettingsUnsavedGuard {
  guardBack: (onLeave: () => void) => void
}

/** Registers one editor with the shared settings navigation guard. */
export function useSettingsUnsavedGuard({
  isDirty,
  navigationBlocked = false,
  onDiscard,
}: UseSettingsUnsavedGuardParams): SettingsUnsavedGuard {
  const id = useId()
  const discardRef = useRef(onDiscard)
  const setGuard = useSettingsDirtyStore((state) => state.setGuard)
  const removeGuard = useSettingsDirtyStore((state) => state.removeGuard)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const hasDiscard = Boolean(onDiscard)
  const discardDraft = useCallback(() => discardRef.current?.(), [])
  const guardBack = useCallback(
    (onLeave: () => void) => {
      requestLeave(onLeave)
    },
    [requestLeave]
  )

  useEffect(() => {
    discardRef.current = onDiscard
  }, [onDiscard])
  useEffect(() => {
    setGuard(id, { isDirty, navigationBlocked, onDiscard: hasDiscard ? discardDraft : undefined })
  }, [id, isDirty, navigationBlocked, hasDiscard, setGuard, discardDraft])
  useEffect(() => () => removeGuard(id), [id, removeGuard])

  return { guardBack }
}
