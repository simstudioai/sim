/**
 * Theme synchronization utilities for managing theme across next-themes and database
 */

/**
 * Updates the theme in next-themes by dispatching a storage event.
 * This works by updating localStorage and notifying next-themes of the change.
 * NOTE: Light mode is temporarily disabled - this function always forces dark mode.
 * @param _theme - The theme parameter (currently ignored, dark mode is forced)
 */
export function syncThemeToNextThemes(_theme: 'system' | 'light' | 'dark') {
  if (typeof window === 'undefined') return

  // Force dark mode - light mode is temporarily disabled
  const forcedTheme = 'dark'

  localStorage.setItem('sim-theme', forcedTheme)

  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'sim-theme',
      newValue: forcedTheme,
      oldValue: localStorage.getItem('sim-theme'),
      storageArea: localStorage,
      url: window.location.href,
    })
  )

  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add('dark')
}

/**
 * Gets the current theme from next-themes localStorage
 */
export function getThemeFromNextThemes(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  return (localStorage.getItem('sim-theme') as 'system' | 'light' | 'dark') || 'system'
}
