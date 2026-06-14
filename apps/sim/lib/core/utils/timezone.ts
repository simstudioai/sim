/** The IANA timezone the current runtime resolves to (e.g. `America/New_York`). */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Every IANA timezone identifier the runtime knows, for populating a picker.
 * Empty on runtimes without `Intl.supportedValuesOf` so callers can fall back.
 */
export function getSupportedTimezones(): string[] {
  return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
}
