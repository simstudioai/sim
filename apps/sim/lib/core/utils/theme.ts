/**
 * Theme synchronization utilities for managing theme across next-themes and database
 */

/**
 * Updates the theme in next-themes by dispatching a storage event.
 * This works by updating localStorage and notifying next-themes of the change.
 * @param _theme - The theme parameter
 */
export function syncThemeToNextThemes(_theme: 'system' | 'light' | 'dark') {
  if (typeof window === 'undefined') return

  localStorage.setItem('sim-theme', _theme)

  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'sim-theme',
      newValue: _theme,
      oldValue: localStorage.getItem('sim-theme'),
      storageArea: localStorage,
      url: window.location.href,
    }),
  )

  const root = document.documentElement
  root.classList.remove('light', 'dark')
  
  if (_theme === 'system') {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    root.classList.add(systemTheme)
  } else {
    root.classList.add(_theme)
  }
}

/**
 * Gets the current theme from next-themes localStorage
 */
export function getThemeFromNextThemes(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  return (
    (localStorage.getItem('sim-theme') as 'system' | 'light' | 'dark') ||
    'system'
  )
}
