/**
 * What the shell ships on each operating system. The preload, the IPC table,
 * the background executor, and device registration all read this one table,
 * so a surface cannot be advertised on one side and refused on the other.
 *
 * Computer use additionally needs a recent macOS; that version check stays
 * with the service that knows the OS release.
 */
export interface DesktopFeatures {
  computerUse: boolean
  /** The native macOS Help menu search field. */
  helpSearch: boolean
  /** Terminal.app and iTerm2 color profiles. */
  terminalThemes: boolean
  /** Chrome cookie and password import. */
  browserImport: boolean
  /**
   * Copying a saved password to the system clipboard. Off on Windows, where
   * Clipboard History and the cloud clipboard keep the text after Sim clears it.
   */
  passwordCopy: boolean
}

const MAC_FEATURES: DesktopFeatures = {
  computerUse: true,
  helpSearch: true,
  terminalThemes: true,
  browserImport: true,
  passwordCopy: true,
}

const WINDOWS_FEATURES: DesktopFeatures = {
  computerUse: false,
  helpSearch: false,
  terminalThemes: false,
  browserImport: false,
  passwordCopy: false,
}

/** Linux is unpackaged: macOS's surfaces minus the macOS-only ones. */
const LINUX_FEATURES: DesktopFeatures = {
  ...MAC_FEATURES,
  computerUse: false,
  helpSearch: false,
  terminalThemes: false,
  browserImport: false,
}

/** The desktop surfaces available on `platform`. */
export function desktopFeatures(platform: NodeJS.Platform): DesktopFeatures {
  if (platform === 'darwin') return MAC_FEATURES
  return platform === 'win32' ? WINDOWS_FEATURES : LINUX_FEATURES
}
