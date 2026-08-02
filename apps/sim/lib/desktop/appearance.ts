import {
  type DesktopAppearanceTheme,
  type DesktopZoomPercent,
  isDesktopAppearanceTheme,
  isDesktopZoomPercent,
  isTerminalAppearanceTheme,
  isTerminalSelectedProfile,
  type TerminalAppearanceTheme,
  type TerminalSelectedProfile,
  type TerminalThemeProfile,
  terminalProfileThemeId,
} from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'

export type DesktopAppearanceSurface = 'browser' | 'terminal'
export type ResolvedDesktopTheme = 'system' | 'light' | 'dark'

export interface DesktopTerminalAppearance {
  theme: TerminalAppearanceTheme
  defaultZoom: DesktopZoomPercent
  selectedProfile?: TerminalSelectedProfile
  profiles: TerminalThemeProfile[]
}

/** Reads one device-level appearance preference, preserving old-shell behavior. */
export async function loadDesktopAppearanceTheme(
  surface: DesktopAppearanceSurface
): Promise<DesktopAppearanceTheme> {
  try {
    const preferences = await getDesktopBridge()?.settings?.getPreferences()
    const value = surface === 'browser' ? preferences?.browserTheme : preferences?.terminalTheme
    return isDesktopAppearanceTheme(value) ? value : 'app'
  } catch {
    return 'app'
  }
}

/** Reads the terminal selection, its cached colors, and currently available source profiles. */
export async function loadDesktopTerminalAppearance(): Promise<DesktopTerminalAppearance> {
  try {
    const bridge = getDesktopBridge()
    const [preferences, profiles] = await Promise.all([
      bridge?.settings?.getPreferences(),
      bridge?.terminalThemes?.listProfiles().catch(() => []) ?? [],
    ])
    const selectedProfile = isTerminalSelectedProfile(preferences?.terminalProfile)
      ? preferences.terminalProfile
      : undefined
    const selectedId = isTerminalAppearanceTheme(preferences?.terminalTheme)
      ? terminalProfileThemeId(preferences.terminalTheme)
      : null
    const theme =
      isTerminalAppearanceTheme(preferences?.terminalTheme) &&
      (!selectedId || selectedProfile?.id === selectedId)
        ? preferences.terminalTheme
        : 'app'
    const defaultZoom = isDesktopZoomPercent(preferences?.terminalDefaultZoom)
      ? preferences.terminalDefaultZoom
      : 100
    return { theme, defaultZoom, ...(selectedProfile ? { selectedProfile } : {}), profiles }
  } catch {
    return { theme: 'app', defaultZoom: 100, profiles: [] }
  }
}

/**
 * Resolves `app` against next-themes' raw or resolved value. `system` stays
 * meaningful for browser CDP; terminal callers treat it as the light fallback
 * until next-themes has resolved.
 */
export function resolveDesktopAppearanceTheme(
  preference: DesktopAppearanceTheme,
  appTheme: string | undefined
): ResolvedDesktopTheme {
  if (preference !== 'app') return preference
  return appTheme === 'light' || appTheme === 'dark' || appTheme === 'system' ? appTheme : 'system'
}
