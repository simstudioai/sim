import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { DOCS_SEARCH_ENDPOINT } from '@/main/external-links'

const logger = createLogger('DesktopHelpSearch')

interface NativeHelpSearchBridge {
  install: (endpoint: string) => boolean
  uninstall: () => void
}

interface HelpSearchRuntime {
  isElectron: boolean
  isMacOS: boolean
  loadBridge: () => unknown
}

let activeBridge: NativeHelpSearchBridge | null = null

function isNativeHelpSearchBridge(value: unknown): value is NativeHelpSearchBridge {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<NativeHelpSearchBridge>
  return typeof candidate.install === 'function' && typeof candidate.uninstall === 'function'
}

function loadNativeBridge(): unknown {
  return require(join(__dirname, 'native', 'help-search.node'))
}

const nativeRuntime: HelpSearchRuntime = {
  isElectron: Boolean(process.versions.electron),
  isMacOS: process.platform === 'darwin',
  loadBridge: loadNativeBridge,
}

/**
 * Registers Sim's documentation index with the native macOS Help search field.
 * The bridge is optional so non-macOS development and unit tests remain portable.
 */
export function installDocumentationHelpSearch(runtime = nativeRuntime): boolean {
  if (!runtime.isMacOS || !runtime.isElectron) return false

  try {
    const bridge = runtime.loadBridge()
    if (!isNativeHelpSearchBridge(bridge)) {
      logger.warn('Native documentation Help search bridge has an invalid interface')
      return false
    }
    if (!bridge.install(DOCS_SEARCH_ENDPOINT)) {
      logger.warn('Native documentation Help search bridge refused its endpoint')
      return false
    }
    activeBridge = bridge
    return true
  } catch (error) {
    logger.warn('Could not install native documentation Help search', {
      error: getErrorMessage(error),
    })
    return false
  }
}

/** Unregisters the native provider before Electron tears AppKit down. */
export function uninstallDocumentationHelpSearch(): void {
  try {
    activeBridge?.uninstall()
  } catch (error) {
    logger.warn('Could not uninstall native documentation Help search', {
      error: getErrorMessage(error),
    })
  } finally {
    activeBridge = null
  }
}
