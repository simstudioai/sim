import type { TerminalAppearanceTheme, TerminalThemeProfile } from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'

/** Lists Terminal.app and iTerm2 profiles independently of the active selection. */
export async function loadDesktopTerminalThemeProfiles(): Promise<TerminalThemeProfile[]> {
  try {
    return (await getDesktopBridge()?.terminalThemes?.listProfiles()) ?? []
  } catch {
    return []
  }
}

/**
 * Keeps the currently selected profile theme selectable even when source
 * profile discovery has not (or no longer) returned it — the picker must
 * always be able to render the active selection.
 */
export function withSelectedProfile(
  profiles: TerminalThemeProfile[],
  theme: TerminalAppearanceTheme
): TerminalThemeProfile[] {
  return typeof theme !== 'string' && !profiles.some(({ id }) => id === theme.id)
    ? [...profiles, theme]
    : profiles
}
