import { createDeferred } from '@sim/testing/helpers/deferred'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestAvailability = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/client', () => ({ requestJson: requestAvailability }))

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
  it.each([
    [true, true, true, true],
    [true, true, false, false],
    [true, false, true, false],
    [false, true, true, false],
  ])(
    'advertises computer use only for a supported enabled device and server rollout (%s,%s,%s)',
    async (supported, enabled, rollout, expected) => {
      installBridge({
        computerUse: {
          getStatus: vi.fn(async () => ({
            supported,
            enabled,
            permissions: { accessibility: false, screenCapture: false },
            activeAction: null,
          })),
        },
      })
      setDesktopPreferencesSnapshot({
        ...ENABLED_PREFERENCES,
        browserEnabled: false,
        terminalEnabled: false,
      })
      requestAvailability.mockResolvedValueOnce({ enabled: rollout })
      const result = await getDesktopChatCapabilities('chat-1', true)
      expect(result.desktopCapabilities?.computerUse ?? false).toBe(expected)
    }
  )
  it('leaves ordinary chat capabilities independent of computer use while rollout is off', async () => {
    const getStatus = vi.fn(() => new Promise(() => {}))
    installBridge({
      computerUse: { getStatus },
      localFiles: vi.fn(),
      terminal: { getTabs: vi.fn(async () => ({ tabs: [] })) },
      browserAgent: { getKnownSessions: vi.fn(async () => ({ sessions: [] })) },
    })
    requestAvailability.mockResolvedValue({ enabled: false })
    const result = await getDesktopChatCapabilities('chat-1', false)
    expect(requestAvailability).not.toHaveBeenCalled()
    expect(getStatus).not.toHaveBeenCalled()
    expect(result.desktopCapabilities).toMatchObject({
      localFiles: true,
      browser: true,
      terminal: true,
    })
  })

  it('does not touch native computer use before the current rollout is confirmed', async () => {
    const rollout = createDeferred<{ enabled: boolean }>()
    const getStatus = vi.fn(async () => ({ supported: true, enabled: true }))
    installBridge({ computerUse: { getStatus } })
    setDesktopPreferencesSnapshot({
      ...ENABLED_PREFERENCES,
      browserEnabled: false,
      terminalEnabled: false,
    })
    requestAvailability.mockReturnValueOnce(rollout.promise)
    const result = getDesktopChatCapabilities('chat-1', true)
    await vi.waitFor(() => expect(requestAvailability).toHaveBeenCalledOnce())
    expect(getStatus).not.toHaveBeenCalled()
    rollout.resolve({ enabled: false })
    expect((await result).desktopCapabilities?.computerUse).toBeUndefined()
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('fails closed when the computer rollout cannot be resolved', async () => {
    const getStatus = vi.fn(async () => ({ supported: true, enabled: true }))
    installBridge({ computerUse: { getStatus } })
    setDesktopPreferencesSnapshot({
      ...ENABLED_PREFERENCES,
      browserEnabled: false,
      terminalEnabled: false,
    })
    requestAvailability.mockRejectedValueOnce(new Error('offline'))
    expect(
      (await getDesktopChatCapabilities('chat-1', true)).desktopCapabilities?.computerUse
    ).toBeUndefined()
    expect(getStatus).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    setDesktopPreferencesSnapshot(ENABLED_PREFERENCES)
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

  it('exposes native file tools without browser, terminal, or folder permissions', async () => {
    installBridge({ localFiles: vi.fn() })
    setDesktopPreferencesSnapshot({
      ...ENABLED_PREFERENCES,
      browserEnabled: false,
      terminalEnabled: false,
    })
    expect(await getDesktopChatCapabilities('org-chat', false)).toMatchObject({
      desktopCapabilities: { localFiles: true },
    })
    installBridge({})
    expect(
      (await getDesktopChatCapabilities('org-chat', false)).desktopCapabilities?.localFiles
    ).toBeUndefined()
  })

  it('offers a turn to the background executor only when the shell has a registered one', async () => {
    setDesktopPreferencesSnapshot({
      ...ENABLED_PREFERENCES,
      browserEnabled: false,
      terminalEnabled: false,
    })
    const offerFrom = async (bridge: Record<string, unknown>) => {
      installBridge({ localFiles: vi.fn(), ...bridge })
      const { desktopCapabilities } = await getDesktopChatCapabilities('chat-1', true)
      return { deviceId: desktopCapabilities?.deviceId, executor: desktopCapabilities?.executor }
    }
    const unset = { deviceId: undefined, executor: undefined }

    expect(await offerFrom({})).toEqual(unset)
    expect(await offerFrom({ desktopExecutor: { getDevice: vi.fn(async () => null) } })).toEqual(
      unset
    )
    expect(
      await offerFrom({
        desktopExecutor: { getDevice: vi.fn(async () => Promise.reject(new Error('IPC closed'))) },
      })
    ).toEqual(unset)
    expect(
      await offerFrom({
        desktopExecutor: {
          getDevice: vi.fn(async () => ({ deviceId: 'device-1', protocolVersion: 1 })),
        },
      })
    ).toEqual({ deviceId: 'device-1', executor: 1 })
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

    const capabilities = await getDesktopChatCapabilities('chat-1', true)

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
