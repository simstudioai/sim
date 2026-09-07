/**
 * @vitest-environment node
 */
import type { DesktopPreferences } from '@sim/desktop-bridge'
import { afterEach, expect, it, vi } from 'vitest'
import {
  isBrowserAgentEnabled,
  isTerminalEnabled,
  setDesktopPreferencesSnapshot,
  subscribeDesktopPreferences,
} from '@/lib/desktop'

afterEach(() => vi.unstubAllGlobals())

it('publishes asynchronous startup preferences and later settings changes to subscribers', async () => {
  const preferences: DesktopPreferences = {
    notificationsEnabled: true,
    notificationSounds: true,
    notificationsOnlyWhenUnfocused: true,
    launchAtLogin: false,
    autoDownloadUpdates: true,
    browserEnabled: false,
    terminalEnabled: true,
  }
  const pending = Promise.withResolvers<DesktopPreferences>()
  const getPreferences = vi.fn(() => pending.promise)
  vi.stubGlobal('window', { simDesktop: { settings: { getPreferences } } })
  const listener = vi.fn()
  const unsubscribe = subscribeDesktopPreferences(listener)
  const otherListener = vi.fn()
  const unsubscribeOther = subscribeDesktopPreferences(otherListener)

  try {
    expect(getPreferences).toHaveBeenCalledOnce()
    expect(isBrowserAgentEnabled()).toBe(true)
    expect(isTerminalEnabled()).toBe(true)
    expect(listener).not.toHaveBeenCalled()

    pending.resolve(preferences)
    await pending.promise
    expect(listener).toHaveBeenCalledOnce()
    expect(otherListener).toHaveBeenCalledOnce()
    expect(isBrowserAgentEnabled()).toBe(false)
    expect(isTerminalEnabled()).toBe(true)

    unsubscribeOther()
    const next = { ...preferences, browserEnabled: true }
    setDesktopPreferencesSnapshot(next)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(otherListener).toHaveBeenCalledOnce()
    expect(isBrowserAgentEnabled()).toBe(true)
    expect(getPreferences).toHaveBeenCalledOnce()
  } finally {
    unsubscribe()
    unsubscribeOther()
  }
})
