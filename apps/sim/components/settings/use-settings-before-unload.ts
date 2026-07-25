import { useEffect } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/**
 * Registers the settings-wide browser unload guard while a section is dirty.
 */
export function useSettingsBeforeUnload() {
  const isDirty = useSettingsDirtyStore((state) => state.isDirty)

  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])
}
