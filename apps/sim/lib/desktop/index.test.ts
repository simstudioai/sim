/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasBrowserAgent,
  hasTerminal,
  isBrowserAgentEnabled,
  isTerminalEnabled,
  setDesktopPreferencesSnapshot,
} from '@/lib/desktop'

const ENABLED_PREFERENCES = {
  notificationsEnabled: true,
  notificationSounds: true,
  notificationsOnlyWhenUnfocused: true,
  launchAtLogin: false,
  autoDownloadUpdates: true,
  browserEnabled: true,
  terminalEnabled: true,
} as const

function installBridge(value: unknown): void {
  vi.stubGlobal('window', { simDesktop: value })
}

describe('desktop surface availability', () => {
  beforeEach(() => {
    setDesktopPreferencesSnapshot(ENABLED_PREFERENCES)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ships every surface with the desktop bridge', () => {
    installBridge({ browserAgent: {}, terminal: {} })

    expect(hasBrowserAgent()).toBe(true)
    expect(hasTerminal()).toBe(true)
    expect(isBrowserAgentEnabled()).toBe(true)
    expect(isTerminalEnabled()).toBe(true)
  })

  it('reports no surfaces outside the desktop app', () => {
    vi.stubGlobal('window', {})

    expect(hasBrowserAgent()).toBe(false)
    expect(hasTerminal()).toBe(false)
    expect(isBrowserAgentEnabled()).toBe(false)
    expect(isTerminalEnabled()).toBe(false)
  })

  it('honors the per-device browser and terminal switches', () => {
    installBridge({ browserAgent: {}, terminal: {} })
    setDesktopPreferencesSnapshot({
      ...ENABLED_PREFERENCES,
      browserEnabled: false,
      terminalEnabled: false,
    })

    expect(hasBrowserAgent()).toBe(true)
    expect(hasTerminal()).toBe(true)
    expect(isBrowserAgentEnabled()).toBe(false)
    expect(isTerminalEnabled()).toBe(false)
  })
})
