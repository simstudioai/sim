import { useEffect } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** Holds a plain click on a same-origin link while an editor is dirty, asking before `navigate`. */
export function useSettingsLeaveLinks(navigate: (destination: URL) => void) {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
      if (
        (!isDirty && !navigationBlocked) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        anchor.dataset.settingsNavigation === 'managed' ||
        (anchor.target && anchor.target !== '_self') ||
        anchor.getAttribute('aria-disabled') === 'true'
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest('button, input, textarea, select, [role="button"]')
      )
        return
      const destination = new URL(anchor.href, window.location.href)
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      requestLeave(() => navigate(destination))
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [navigate])
}
