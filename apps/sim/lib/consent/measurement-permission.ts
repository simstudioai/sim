let observedWithdrawal = false

/** Prevents an older c15t runtime grant from overriding a newer choice in another tab. */
export function getStoredMeasurementPermission(): boolean {
  try {
    const raw = window.localStorage.getItem('c15t')
    /** Initial absence allows c15t's jurisdiction defaults; deletion of a choice does not. */
    if (raw === null) return !observedWithdrawal
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('consents' in value)) return false
    const { consents } = value
    return (
      !!consents &&
      typeof consents === 'object' &&
      'measurement' in consents &&
      consents.measurement === true
    )
  } catch {
    return false
  }
}

/** Observes browser storage without changing c15t state or reloading other tabs. */
export function subscribeStoredMeasurementPermission(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== window.localStorage) return
    if (event.key !== 'c15t' && event.key !== null) return
    if (event.newValue === null) observedWithdrawal = true
    onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
