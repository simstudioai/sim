/** Whether a user agent names macOS or iOS, where shortcuts use ⌘ and ⌥. */
export function isMacUserAgent(userAgent: string): boolean {
  return /Mac|iPhone|iPod|iPad/i.test(userAgent)
}

/**
 * Detects whether the current platform is macOS/iOS.
 * Returns false during SSR.
 */
export function isMacPlatform(): boolean {
  if (typeof window === 'undefined') return false
  return isMacUserAgent(navigator.userAgent)
}
