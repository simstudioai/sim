import { useEffect } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/**
 * Registers a single `beforeunload` guard for the whole settings surface,
 * active only while some section reports unsaved changes via
 * `useSettingsDirtyStore`. Mounted once in the settings shell so individual
 * pages never register their own.
 */
export function useSettingsBeforeUnload() {
  const isDirty = useSettingsDirtyStore((s) => s.isDirty)

  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])
}
