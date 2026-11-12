/**
 * Detects whether the current platform is macOS/iOS.
 * Returns false during SSR.
 */
export function isMacPlatform(): boolean {
  if (typeof window === 'undefined') return false
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
}

/**
 * Labels a primary-modifier shortcut: `⌘F` on macOS, `Ctrl+F` elsewhere, where
 * the desktop shell and browsers bind the same command to Control.
 */
export function formatShortcut(key: string): string {
  return isMacPlatform() ? `⌘${key}` : `Ctrl+${key}`
}
