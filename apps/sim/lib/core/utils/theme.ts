/**
 * Theme synchronization utilities for managing theme across next-themes and database
 */

/**
 * Updates the theme in next-themes by dispatching a storage event.
 * This works by updating localStorage and notifying next-themes of the change.
 * The active provider owns document classes, including forced themes and the
 * landing surface's independent preference.
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
}
