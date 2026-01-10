/**
 * Theme synchronization utilities for managing theme across next-themes and database
 */

/**
 * Updates the theme in next-themes by dispatching a storage event.
 * This works by updating localStorage and notifying next-themes of the change.
 * @param theme - The desired theme ('system', 'light', or 'dark')
 */
export function syncThemeToNextThemes(theme: 'system' | 'light' | 'dark') {
  if (typeof window === 'undefined') return

  const oldValue = localStorage.getItem('sim-theme')
  localStorage.setItem('sim-theme', theme)

  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'sim-theme',
      newValue: theme,
      oldValue: oldValue,
      storageArea: localStorage,
      url: window.location.href,
    })
  )

  const root = document.documentElement
  root.classList.remove('light', 'dark')

  if (theme === 'system') {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    root.classList.add(systemTheme)
  } else {
    root.classList.add(theme)
  }
}

/**
 * Gets the current theme from next-themes localStorage
 */
export function getThemeFromNextThemes(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return (localStorage.getItem('sim-theme') as 'system' | 'light' | 'dark') || 'dark'
}
