export const SETTINGS_RETURN_URL_KEY = 'settings-return-url'

function settingsScope(pathname: string): string | undefined {
  return pathname.match(/^(\/(?:workspace|o)\/[^/?#]+)\/settings(?:\/|$)/)?.[1]
}

/** Captures a complete return URL only when entering settings from the same owning surface. */
export function rememberSettingsReturnUrl(settingsHref: string): void {
  const scope = settingsScope(settingsHref)
  const { pathname, search, hash } = window.location
  if (!scope || !pathname.startsWith(`${scope}/`) || settingsScope(pathname)) return
  try {
    sessionStorage.setItem(SETTINGS_RETURN_URL_KEY, `${pathname}${search}${hash}`)
  } catch {}
}

/** Consumes the saved destination only when it belongs to the current settings owner. */
export function popSettingsReturnUrl(fallback: string): string {
  try {
    const stored = sessionStorage.getItem(SETTINGS_RETURN_URL_KEY)
    sessionStorage.removeItem(SETTINGS_RETURN_URL_KEY)
    const scope = settingsScope(window.location.pathname)
    return scope && stored?.startsWith(`${scope}/`) && !settingsScope(stored) ? stored : fallback
  } catch {
    return fallback
  }
}
