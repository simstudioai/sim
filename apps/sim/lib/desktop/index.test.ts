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

describe('desktop scoped surface availability', () => {
  beforeEach(() => {
    setDesktopPreferencesSnapshot(ENABLED_PREFERENCES)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not enable legacy global browser or terminal surfaces', () => {
    installBridge({ browserAgent: {}, terminal: {} })

    expect(hasBrowserAgent()).toBe(true)
    expect(hasTerminal()).toBe(true)
    expect(isBrowserAgentEnabled()).toBe(false)
    expect(isTerminalEnabled()).toBe(false)
  })

  it('requires both activation and migration for each scoped surface', () => {
    installBridge({
      browserAgent: { activateScope: vi.fn() },
      terminal: { migrateScope: vi.fn() },
    })

    expect(isBrowserAgentEnabled()).toBe(false)
    expect(isTerminalEnabled()).toBe(false)
  })

  it('enables surfaces that implement chat scope activation and migration', () => {
    installBridge({
      browserAgent: { activateScope: vi.fn(), migrateScope: vi.fn() },
      terminal: { activateScope: vi.fn(), migrateScope: vi.fn() },
    })

    expect(isBrowserAgentEnabled()).toBe(true)
    expect(isTerminalEnabled()).toBe(true)
  })
})
