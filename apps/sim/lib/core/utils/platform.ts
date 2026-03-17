/**
 * Detects whether the current platform is macOS/iOS.
 * Returns false during SSR.
 */
export function isMacPlatform(): boolean {
  if (typeof window === 'undefined') return false
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
}
