/**
 * Theme synchronization utilities for managing theme across next-themes and database
 */

/**
 * Updates the theme in next-themes by dispatching a storage event
 * This works by updating localStorage and notifying next-themes of the change
 */
export function syncThemeToNextThemes(theme: 'system' | 'light' | 'dark') {
  if (typeof window === 'undefined') return

  // Update localStorage
  localStorage.setItem('sim-theme', theme)

  // Dispatch storage event to notify next-themes
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'sim-theme',
      newValue: theme,
      oldValue: localStorage.getItem('sim-theme'),
      storageArea: localStorage,
      url: window.location.href,
    })
  )

  // Also update the HTML class immediately for instant feedback
  const root = document.documentElement
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const actualTheme = theme === 'system' ? systemTheme : theme

  // Remove existing theme classes
  root.classList.remove('light', 'dark')
  // Add new theme class
  root.classList.add(actualTheme)
}

/**
 * Gets the current theme from next-themes localStorage
 */
export function getThemeFromNextThemes(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  return (localStorage.getItem('sim-theme') as 'system' | 'light' | 'dark') || 'system'
}
