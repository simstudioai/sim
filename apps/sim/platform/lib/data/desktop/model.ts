import type { getDesktopBridge } from '@/lib/desktop'

/**
 * The shell's types, named from the bridge `lib/desktop` returns: the zone reaches the desktop only
 * through that accessor, so a change to the bridge's shape surfaces here.
 */
export type DesktopApi = NonNullable<ReturnType<typeof getDesktopBridge>>
export type DesktopPreferences = Awaited<ReturnType<DesktopApi['settings']['getPreferences']>>
export type DesktopPreferenceKey = Parameters<DesktopApi['settings']['setPreference']>[0]
export type DesktopZoomPercent = DesktopPreferences['browserDefaultZoom']
export type DesktopAppearanceTheme = DesktopPreferences['browserTheme']
export type TerminalAppearanceTheme = DesktopPreferences['terminalTheme']
export type TerminalThemeProfile = Awaited<
  ReturnType<NonNullable<DesktopApi['terminalThemes']>['listProfiles']>
>[number]
export type BrowserCredential = Awaited<
  ReturnType<DesktopApi['browserCredentials']['list']>
>[number]
export type BrowserDataKind = NonNullable<
  Parameters<DesktopApi['browserAgent']['clearBrowsingData']>[0]
>[number]
type BrowserImportApi = NonNullable<DesktopApi['browserImport']>
export type BrowserImportProfile = Awaited<
  ReturnType<BrowserImportApi['listChromeProfiles']>
>[number]
export type BrowserChromeImportResult = Awaited<ReturnType<BrowserImportApi['importFromChrome']>>
export type BrowserImportError = NonNullable<BrowserChromeImportResult['cookies']['error']>
export type ComputerUseAppPermission = Awaited<
  ReturnType<NonNullable<DesktopApi['computerUse']>['listAppPermissions']>
>[number]

/** The shell's zoom steps (`DESKTOP_ZOOM_PERCENTS`), which the zone may not import directly. */
export const DESKTOP_ZOOM_PERCENTS = [
  67, 75, 80, 90, 100, 110, 125, 150, 175, 200,
] as const satisfies readonly DesktopZoomPercent[]

export function isDesktopZoomPercent(value: number): value is DesktopZoomPercent {
  return (DESKTOP_ZOOM_PERCENTS as readonly number[]).includes(value)
}

/** Every kind of data the built-in browser can clear (`BROWSER_DATA_KINDS`). */
export const BROWSER_DATA_KINDS = [
  'cookies',
  'site-data',
  'cache',
] as const satisfies readonly BrowserDataKind[]
