import {
  type DesktopAppearanceTheme,
  type DesktopZoomPercent,
  isDesktopAppearanceTheme,
  isDesktopZoomPercent,
  isTerminalAppearanceTheme,
  TERMINAL_DARK_THEME,
  TERMINAL_LIGHT_THEME,
  type TerminalAppearanceTheme,
  type TerminalThemePalette,
  type TerminalThemeProfile,
} from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'

export type ResolvedDesktopTheme = 'system' | 'light' | 'dark'

export interface DesktopTerminalAppearance {
  theme: TerminalAppearanceTheme
  defaultZoom: DesktopZoomPercent
}

/** Reads the device-level browser appearance preference. */
export async function loadDesktopBrowserAppearanceTheme(): Promise<DesktopAppearanceTheme> {
  try {
    const preferences = await getDesktopBridge()?.settings.getPreferences()
    const value = preferences?.browserTheme
    return isDesktopAppearanceTheme(value) ? value : 'app'
  } catch {
    return 'app'
  }
}

/** Reads the persisted terminal appearance without waiting for source profile discovery. */
export async function loadDesktopTerminalAppearance(): Promise<DesktopTerminalAppearance> {
  try {
    const preferences = await getDesktopBridge()?.settings.getPreferences()
    const theme = isTerminalAppearanceTheme(preferences?.terminalTheme)
      ? preferences.terminalTheme
      : 'app'
    const defaultZoom = isDesktopZoomPercent(preferences?.terminalDefaultZoom)
      ? preferences.terminalDefaultZoom
      : 100
    return { theme, defaultZoom }
  } catch {
    return { theme: 'app', defaultZoom: 100 }
  }
}

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

/** Replaces a persisted profile snapshot with freshly discovered source colors. */
export function refreshSelectedTerminalProfile(
  profiles: TerminalThemeProfile[],
  theme: TerminalAppearanceTheme
): TerminalAppearanceTheme {
  if (typeof theme === 'string') return theme
  return profiles.find(({ id }) => id === theme.id) ?? theme
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

/**
 * Resolves built-in and imported terminal palettes against Sim's live
 * appearance. Imported profiles always follow the app appearance — they carry
 * their own colors, so there is no separate preference to pin them to.
 */
export function resolveTerminalThemePalette(
  theme: TerminalAppearanceTheme,
  appTheme: string | undefined
): TerminalThemePalette {
  if (typeof theme !== 'string') {
    return resolveDesktopAppearanceTheme('app', appTheme) === 'dark'
      ? (theme.darkPalette ?? theme.palette)
      : (theme.lightPalette ?? theme.palette)
  }
  return resolveDesktopAppearanceTheme(theme, appTheme) === 'dark'
    ? TERMINAL_DARK_THEME
    : TERMINAL_LIGHT_THEME
}
