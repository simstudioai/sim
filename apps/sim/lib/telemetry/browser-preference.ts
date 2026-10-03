const STORAGE_KEY = 'simstudio-telemetry-status'
const CHANGE_EVENT = 'sim:telemetry-preference'

let unavailableStoragePreference: boolean | undefined

/** The account preference and cookie consent are checked separately before collection starts. */
export function getBrowserTelemetryPreference(): boolean {
  if (unavailableStoragePreference !== undefined) return unavailableStoragePreference
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === null) return true
    const preference: unknown = JSON.parse(stored)
    return (
      typeof preference === 'object' &&
      preference !== null &&
      'enabled' in preference &&
      preference.enabled === true
    )
  } catch {
    return false
  }
}

/** Persists explicit choices and notifies collectors in this tab immediately. */
export function setBrowserTelemetryPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }))
    unavailableStoragePreference = undefined
  } catch {
    unavailableStoragePreference = enabled
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Observes local choices and withdrawals made in another tab. */
export function subscribeBrowserTelemetryPreference(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      unavailableStoragePreference = undefined
      onChange()
    }
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}
