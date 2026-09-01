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
  if (oldValue !== theme) {
    localStorage.setItem('sim-theme', theme)

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'sim-theme',
        newValue: theme,
        oldValue,
        storageArea: localStorage,
        url: window.location.href,
      })
    )
  }

  const root = document.documentElement
  const appliedTheme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  const oppositeTheme = appliedTheme === 'dark' ? 'light' : 'dark'
  if (root.classList.contains(appliedTheme) && !root.classList.contains(oppositeTheme)) return

  root.classList.remove('light', 'dark')
  root.classList.add(appliedTheme)
}
