/**
 * Theme synchronization utilities for managing theme across next-themes and database
 */

/**
 * Updates the theme in next-themes by dispatching a storage event.
 * This works by updating localStorage and notifying next-themes of the change.
 * @param theme - The theme to apply: 'system', 'light', or 'dark'
 */
export function syncThemeToNextThemes(theme: 'system' | 'light' | 'dark') {
  if (typeof window === 'undefined') return

  localStorage.setItem('sim-theme', theme)

  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'sim-theme',
      newValue: theme,
      oldValue: localStorage.getItem('sim-theme'),
      storageArea: localStorage,
      url: window.location.href,
    })
  )

  const root = document.documentElement
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const actualTheme = theme === 'system' ? systemTheme : theme

  root.classList.remove('light', 'dark')
  root.classList.add(actualTheme)
}

/**
 * Gets the current theme from next-themes localStorage
 */
export function getThemeFromNextThemes(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  return (localStorage.getItem('sim-theme') as 'system' | 'light' | 'dark') || 'system'
}
