/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDesktopChatCapabilities,
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

  it('bounds terminal hints before adding them to a chat request', async () => {
    const oversizedValue = 'x'.repeat(1100)
    installBridge({
      terminal: {
        getTabs: vi.fn(async () => ({
          scopeId: 'chat-1',
          activeTerminalId: '1',
          tabs: [
            {
              terminalId: '1',
              title: 'Terminal',
              cwd: oversizedValue,
              running: oversizedValue,
              interactive: false,
              active: true,
            },
          ],
        })),
      },
    })
    setDesktopPreferencesSnapshot({
      ...ENABLED_PREFERENCES,
      browserEnabled: false,
    })

    const capabilities = await getDesktopChatCapabilities('chat-1')

    expect(capabilities.desktopCapabilities?.terminals).toEqual([
      {
        id: '1',
        cwd: 'x'.repeat(1024),
        running: 'x'.repeat(1024),
        active: true,
      },
    ])
  })
})
