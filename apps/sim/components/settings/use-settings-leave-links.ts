import { useEffect } from 'react'
import { inAppLinkDestination } from '@/lib/core/utils/in-app-link'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** Holds a plain click on a same-origin link while an editor is dirty, asking before `navigate`. */
export function useSettingsLeaveLinks(navigate: (destination: URL) => void) {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
      if (!isDirty && !navigationBlocked) return
      const destination = inAppLinkDestination(event)
      if (!destination) return
      event.preventDefault()
      event.stopImmediatePropagation()
      requestLeave(() => navigate(destination))
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [navigate])
}
